const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body } = require('express-validator');
const { query, withTransaction } = require('../db/pool');
const { handleValidation } = require('../middleware/validate');
const { authRequired } = require('../middleware/auth');
const { authLimiter, recoveryLimiter } = require('../middleware/rateLimit');
const { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllUserTokens, hashToken } = require('../utils/tokens');
const { serializeUser, createNotification } = require('../utils/helpers');
const { sendEmail } = require('../utils/email');
const { sendSms } = require('../utils/sms');
const logger = require('../utils/logger');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

function clientMeta(req) {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

function issueTokenPair(res, user, meta) {
  return issueRefreshToken(user.id, meta).then((refresh) => {
    const access_token = signAccessToken(user);
    return { access_token, refresh_token: refresh.raw, refresh_expires_at: refresh.expires_at };
  });
}

// ===== Register (joins an existing organization via its org_code / slug) =====
router.post(
  '/register',
  authLimiter,
  [
    body('org_code').trim().notEmpty().withMessage('Organization code is required'),
    body('username').matches(USERNAME_RE).withMessage('Username must be 3-20 chars: letters, numbers, underscore, dot'),
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('phone').trim().isLength({ min: 7, max: 20 }).withMessage('Valid phone number is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { org_code, username, name, email, phone, password, bio } = req.body;

      const orgRes = await query('SELECT * FROM organizations WHERE slug = $1', [org_code.trim().toLowerCase()]);
      const org = orgRes.rows[0];
      if (!org) return res.status(404).json({ error: 'Unknown organization code. Check with your organization admin.' });
      if (org.status === 'disabled') return res.status(403).json({ error: 'This organization is currently disabled.' });

      const existing = await query(
        `SELECT id FROM users WHERE org_id = $1 AND (username = $2 OR email = $3 OR phone = $4)`,
        [org.id, username, email, phone]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Username, email or phone already in use within this organization' });
      }

      const password_hash = await bcrypt.hash(password, 12);

      const user = await withTransaction(async (client) => {
        const ures = await client.query(
          `INSERT INTO users (org_id, username, name, phone, email, password_hash, bio, role)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'member') RETURNING *`,
          [org.id, username, name, phone, email, password_hash, bio || '']
        );
        const newUser = ures.rows[0];
        await client.query('INSERT INTO locations (user_id, org_id, is_live) VALUES ($1, $2, false)', [newUser.id, org.id]);
        return newUser;
      });

      const authUser = { id: user.id, org_id: user.org_id, role: user.role, username: user.username };
      const tokens = await issueTokenPair(res, authUser, clientMeta(req));

      res.status(201).json({ ...tokens, user: await serializeUser(user, authUser) });
    } catch (err) {
      next(err);
    }
  }
);

// ===== Login (accepts username or email; scoped by org_code since usernames are per-org) =====
router.post(
  '/login',
  authLimiter,
  [
    body('org_code').trim().notEmpty().withMessage('Organization code is required'),
    body('identifier').trim().notEmpty().withMessage('Username or email is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { org_code, identifier, password } = req.body;

      const orgRes = await query('SELECT * FROM organizations WHERE slug = $1', [org_code.trim().toLowerCase()]);
      const org = orgRes.rows[0];
      if (!org) return res.status(401).json({ error: 'Invalid credentials' });

      const uRes = await query(
        `SELECT * FROM users WHERE org_id = $1 AND (username = $2 OR email = $2)`,
        [org.id, identifier]
      );
      const user = uRes.rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      if (user.status === 'disabled') return res.status(403).json({ error: 'This account has been disabled. Contact your administrator.' });
      if (org.status === 'disabled') return res.status(403).json({ error: 'This organization is currently disabled.' });

      const authUser = { id: user.id, org_id: user.org_id, role: user.role, username: user.username };
      const tokens = await issueTokenPair(res, authUser, clientMeta(req));

      res.json({ ...tokens, user: await serializeUser(user, authUser) });
    } catch (err) {
      next(err);
    }
  }
);

// Platform-level login for the Super Admin (no org_code — super admins have org_id = NULL)
router.post(
  '/super-admin/login',
  authLimiter,
  [body('identifier').trim().notEmpty(), body('password').notEmpty()],
  handleValidation,
  async (req, res, next) => {
    try {
      const { identifier, password } = req.body;
      const uRes = await query(
        `SELECT * FROM users WHERE role = 'super_admin' AND (username = $1 OR email = $1)`,
        [identifier]
      );
      const user = uRes.rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      if (user.status === 'disabled') return res.status(403).json({ error: 'This account has been disabled.' });

      const authUser = { id: user.id, org_id: null, role: user.role, username: user.username };
      const tokens = await issueTokenPair(res, authUser, clientMeta(req));
      res.json({ ...tokens, user: await serializeUser(user, authUser) });
    } catch (err) {
      next(err);
    }
  }
);

// ===== Refresh (rotates the refresh token; old one becomes unusable) =====
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token is required' });

    const rotated = await rotateRefreshToken(refresh_token, clientMeta(req));
    const uRes = await query('SELECT * FROM users WHERE id = $1', [rotated.userId]);
    const user = uRes.rows[0];
    if (!user || user.status === 'disabled') return res.status(401).json({ error: 'Account unavailable' });

    const authUser = { id: user.id, org_id: user.org_id, role: user.role, username: user.username };
    const access_token = signAccessToken(authUser);

    res.json({ access_token, refresh_token: rotated.raw, refresh_expires_at: rotated.expires_at });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ===== Logout (revokes the presented refresh token only) =====
router.post('/logout', async (req, res) => {
  const { refresh_token } = req.body || {};
  if (refresh_token) await revokeRefreshToken(refresh_token);
  res.json({ message: 'Logged out' });
});

// ===== Logout everywhere (revokes every refresh token for the authenticated user) =====
router.post('/logout-all', authRequired, async (req, res) => {
  await revokeAllUserTokens(req.user.id);
  res.json({ message: 'Logged out on all devices' });
});

router.get('/me', authRequired, async (req, res, next) => {
  try {
    const uRes = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.json({ user: await serializeUser(uRes.rows[0], req.user) });
  } catch (err) {
    next(err);
  }
});

// ===== Account recovery =====
// Self-service: never reveals whether the account exists, never returns the token/password.
router.post(
  '/forgot-username',
  recoveryLimiter,
  [body('org_code').trim().notEmpty(), body('email_or_phone').trim().notEmpty()],
  handleValidation,
  async (req, res, next) => {
    try {
      const { org_code, email_or_phone } = req.body;
      const orgRes = await query('SELECT id FROM organizations WHERE slug = $1', [org_code.trim().toLowerCase()]);
      const org = orgRes.rows[0];
      const generic = { message: 'If a matching account exists, recovery instructions have been sent.' };
      if (!org) return res.json(generic);

      const uRes = await query(
        `SELECT * FROM users WHERE org_id = $1 AND (email = $2 OR phone = $2)`,
        [org.id, email_or_phone]
      );
      const user = uRes.rows[0];
      if (user) {
        await sendEmail(user.email, 'Your RideMesh username', `Your username is: ${user.username}`);
      }
      res.json(generic);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/forgot-password',
  recoveryLimiter,
  [body('org_code').trim().notEmpty(), body('identifier').trim().notEmpty()],
  handleValidation,
  async (req, res, next) => {
    try {
      const { org_code, identifier } = req.body;
      const generic = { message: 'If a matching account exists, recovery instructions have been sent.' };

      const orgRes = await query('SELECT id FROM organizations WHERE slug = $1', [org_code.trim().toLowerCase()]);
      const org = orgRes.rows[0];
      if (!org) return res.json(generic);

      const uRes = await query(`SELECT * FROM users WHERE org_id = $1 AND (username = $2 OR email = $2)`, [org.id, identifier]);
      const user = uRes.rows[0];
      if (!user) return res.json(generic);

      const raw = crypto.randomBytes(32).toString('hex');
      const token_hash = hashToken(raw);
      const expires_at = new Date(Date.now() + 30 * 60 * 1000);
      await query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, requested_by_role, expires_at) VALUES ($1, $2, 'self', $3)`,
        [user.id, token_hash, expires_at]
      );

      // Never send the token/password via SMS or return it in the API response.
      // Self-service delivery is via email (stub); administrators are also notified so
      // they can assist directly if the rider can't access email.
      await sendEmail(user.email, 'Reset your RideMesh password', `Use this token within 30 minutes: ${raw}`);

      const admins = await query(`SELECT id, phone FROM users WHERE org_id = $1 AND role = 'org_admin' AND status = 'active'`, [org.id]);
      for (const admin of admins.rows) {
        await createNotification(org.id, admin.id, 'system', `${user.name} (@${user.username}) requested a password reset.`, user.id);
        await sendSms(admin.phone, `RideMesh: ${user.name} requested a password reset. Check the admin panel.`);
      }

      res.json(generic);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/reset-password',
  recoveryLimiter,
  [body('reset_token').notEmpty(), body('new_password').isLength({ min: 8 })],
  handleValidation,
  async (req, res, next) => {
    try {
      const { reset_token, new_password } = req.body;
      const token_hash = hashToken(reset_token);
      const tRes = await query('SELECT * FROM password_reset_tokens WHERE token_hash = $1', [token_hash]);
      const row = tRes.rows[0];
      if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }

      const password_hash = await bcrypt.hash(new_password, 12);
      await withTransaction(async (client) => {
        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, row.user_id]);
        await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);
        await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id]);
      });

      res.json({ message: 'Password updated. Please log in again.' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
