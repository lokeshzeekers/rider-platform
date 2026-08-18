const { verifyAccessToken } = require('../utils/tokens');
const { query } = require('../db/pool');

// Verifies the JWT AND re-checks the user's live status/org status in the DB on every
// request. This means a disabled account or disabled org is locked out immediately,
// not just after their access token happens to expire.
async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired access token' });
  }

  try {
    const res2 = await query(
      `SELECT u.id, u.org_id, u.username, u.name, u.role, u.status as user_status,
              o.status as org_status
       FROM users u LEFT JOIN organizations o ON o.id = u.org_id
       WHERE u.id = $1`,
      [payload.sub]
    );
    const row = res2.rows[0];
    if (!row) return res.status(401).json({ error: 'User no longer exists' });
    if (row.user_status === 'disabled') return res.status(403).json({ error: 'Account disabled. Contact your administrator.' });
    if (row.role !== 'super_admin' && row.org_status === 'disabled') {
      return res.status(403).json({ error: 'Your organization has been disabled. Contact support.' });
    }

    req.user = { id: row.id, org_id: row.org_id, username: row.username, name: row.name, role: row.role };
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

const requireSuperAdmin = requireRole('super_admin');
const requireOrgAdminOrAbove = requireRole('org_admin', 'super_admin');

// Ensures the resource's org_id (already loaded by the route) matches the caller's org,
// unless the caller is a super_admin. This is the tenant-isolation backstop used
// throughout org-admin routes, in addition to every query already filtering by org_id.
function assertSameOrg(req, resourceOrgId) {
  if (req.user.role === 'super_admin') return true;
  return req.user.org_id === resourceOrgId;
}

module.exports = { authRequired, requireRole, requireSuperAdmin, requireOrgAdminOrAbove, assertSameOrg };
