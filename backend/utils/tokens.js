const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db/pool');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30', 10);

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in the environment');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, org_id: user.org_id, role: user.role, username: user.username },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

// Issues a new refresh token, stores only its hash, and returns the raw token to give the client.
async function issueRefreshToken(userId, { userAgent, ip } = {}) {
  const raw = crypto.randomBytes(48).toString('hex');
  const token_hash = hashToken(raw);
  const expires_at = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  const res = await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, token_hash, userAgent || null, ip || null, expires_at]
  );

  return { raw, id: res.rows[0].id, expires_at };
}

// Validates a raw refresh token against the DB (not just JWT-signed — it must also be
// un-revoked and unexpired in refresh_tokens), and rotates it: the old row is marked
// revoked + replaced_by, and a new token is issued. This means a stolen-and-reused
// refresh token is detectable (its row will already show revoked_at set).
async function rotateRefreshToken(rawToken, { userAgent, ip } = {}) {
  const token_hash = hashToken(rawToken);
  const res = await query(`SELECT * FROM refresh_tokens WHERE token_hash = $1`, [token_hash]);
  const row = res.rows[0];

  if (!row) {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }
  if (row.revoked_at) {
    // Reuse of a rotated/revoked token — treat as a compromise signal and revoke the whole chain.
    await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [row.user_id]);
    const err = new Error('Refresh token has already been used. Please log in again.');
    err.status = 401;
    throw err;
  }
  if (new Date(row.expires_at) < new Date()) {
    const err = new Error('Refresh token expired');
    err.status = 401;
    throw err;
  }

  const next = await issueRefreshToken(row.user_id, { userAgent, ip });
  await query(`UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2`, [next.id, row.id]);

  return { userId: row.user_id, ...next };
}

async function revokeRefreshToken(rawToken) {
  const token_hash = hashToken(rawToken);
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [token_hash]);
}

async function revokeAllUserTokens(userId) {
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  hashToken
};
