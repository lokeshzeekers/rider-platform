const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db/pool');
const { authRequired, requireOrgAdminOrAbove } = require('../middleware/auth');
const { revokeAllUserTokens } = require('../utils/tokens');
const { recordAudit } = require('../utils/audit');

const router = express.Router();
router.use(authRequired, requireOrgAdminOrAbove);

// Every query below filters by `orgId(req)` -- for org_admin this is always their own
// org_id from the verified token (never a client-supplied value), so there is no way for
// an org_admin to reach another organization's data even if they tamper with the request.
// A super_admin hitting these routes may pass ?org_id= to act on a specific org; if they
// don't, they operate on... nothing implicit -- see the guard below.
function orgId(req) {
  if (req.user.role === 'org_admin') return req.user.org_id;
  return req.query.org_id || req.body.org_id || null;
}

router.use((req, res, next) => {
  const id = orgId(req);
  if (!id) return res.status(400).json({ error: 'org_id is required' });
  req.scopedOrgId = id;
  next();
});

router.get('/summary', async (req, res, next) => {
  try {
    const totalUsers = (await query(`SELECT COUNT(*)::int c FROM users WHERE org_id = $1`, [req.scopedOrgId])).rows[0].c;
    const activeUsers = (await query(`SELECT COUNT(*)::int c FROM users WHERE org_id = $1 AND status='active'`, [req.scopedOrgId])).rows[0].c;
    const disabledUsers = (await query(`SELECT COUNT(*)::int c FROM users WHERE org_id = $1 AND status='disabled'`, [req.scopedOrgId])).rows[0].c;
    const liveRiders = (await query(`SELECT COUNT(*)::int c FROM locations WHERE org_id = $1 AND is_live = true`, [req.scopedOrgId])).rows[0].c;
    const totalTrips = (await query(`SELECT COUNT(*)::int c FROM trips WHERE org_id = $1`, [req.scopedOrgId])).rows[0].c;
    const activeTrips = (await query(`SELECT COUNT(*)::int c FROM trips WHERE org_id = $1 AND status='active'`, [req.scopedOrgId])).rows[0].c;
    const completedTrips = (await query(`SELECT COUNT(*)::int c FROM trips WHERE org_id = $1 AND status='completed'`, [req.scopedOrgId])).rows[0].c;
    res.json({ totalUsers, activeUsers, disabledUsers, liveRiders, totalTrips, activeTrips, completedTrips });
  } catch (err) {
    next(err);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const r = q
      ? await query(
          `SELECT id, username, name, phone, email, role, status, created_at FROM users
           WHERE org_id = $1 AND (username ILIKE $2 OR name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)
           ORDER BY created_at DESC LIMIT 200`,
          [req.scopedOrgId, `%${q}%`]
        )
      : await query(
          `SELECT id, username, name, phone, email, role, status, created_at FROM users WHERE org_id = $1 ORDER BY created_at DESC LIMIT 200`,
          [req.scopedOrgId]
        );
    res.json({ users: r.rows });
  } catch (err) {
    next(err);
  }
});

async function assertUserInScopedOrg(req, res, userId) {
  const r = await query('SELECT * FROM users WHERE id = $1 AND org_id = $2', [userId, req.scopedOrgId]);
  if (!r.rows[0]) {
    res.status(404).json({ error: 'User not found in this organization' });
    return null;
  }
  return r.rows[0];
}

router.post('/users/:id/disable', async (req, res, next) => {
  try {
    const target = await assertUserInScopedOrg(req, res, req.params.id);
    if (!target) return;
    if (target.role === 'org_admin' && req.user.role === 'org_admin') {
      return res.status(403).json({ error: 'Org admins cannot disable other org admins' });
    }
    await query(`UPDATE users SET status='disabled' WHERE id=$1`, [target.id]);
    await revokeAllUserTokens(target.id);
    await recordAudit({ actorUserId: req.user.id, actorRole: req.user.role, orgId: req.scopedOrgId, action: 'user.disable', targetType: 'user', targetId: target.id, ip: req.ip });
    res.json({ message: 'Account disabled' });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/enable', async (req, res, next) => {
  try {
    const target = await assertUserInScopedOrg(req, res, req.params.id);
    if (!target) return;
    await query(`UPDATE users SET status='active' WHERE id=$1`, [target.id]);
    await recordAudit({ actorUserId: req.user.id, actorRole: req.user.role, orgId: req.scopedOrgId, action: 'user.enable', targetType: 'user', targetId: target.id, ip: req.ip });
    res.json({ message: 'Account enabled' });
  } catch (err) {
    next(err);
  }
});

// Admin-assisted password reset: the admin sets a new password and relays it to the rider
// out-of-band (phone call, in person, etc.) -- it is never emailed/SMSed/returned via API.
router.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    const target = await assertUserInScopedOrg(req, res, req.params.id);
    if (!target) return;
    const { new_password } = req.body || {};
    if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'new_password must be at least 8 characters' });

    const password_hash = await bcrypt.hash(new_password, 12);
    await query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [password_hash, target.id]);
    await revokeAllUserTokens(target.id);
    await recordAudit({ actorUserId: req.user.id, actorRole: req.user.role, orgId: req.scopedOrgId, action: 'user.reset_password', targetType: 'user', targetId: target.id, ip: req.ip });
    res.json({ message: 'Password reset. Relay the new password to the rider directly -- it is never sent via SMS or email.' });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/change-username', async (req, res, next) => {
  try {
    const target = await assertUserInScopedOrg(req, res, req.params.id);
    if (!target) return;
    const { new_username } = req.body || {};
    if (!new_username || !/^[a-zA-Z0-9_.]{3,20}$/.test(new_username)) {
      return res.status(400).json({ error: 'Invalid username format' });
    }
    const clash = await query('SELECT id FROM users WHERE org_id = $1 AND username = $2', [req.scopedOrgId, new_username]);
    if (clash.rows.length > 0) return res.status(409).json({ error: 'Username already taken in this organization' });

    await query(`UPDATE users SET username=$1 WHERE id=$2`, [new_username, target.id]);
    await recordAudit({ actorUserId: req.user.id, actorRole: req.user.role, orgId: req.scopedOrgId, action: 'user.change_username', targetType: 'user', targetId: target.id, metadata: { new_username }, ip: req.ip });
    res.json({ message: 'Username updated' });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    const target = await assertUserInScopedOrg(req, res, req.params.id);
    if (!target) return;
    if (target.role === 'org_admin' && req.user.role === 'org_admin') {
      return res.status(403).json({ error: 'Org admins cannot delete other org admins' });
    }
    await query('DELETE FROM users WHERE id = $1', [target.id]);
    await recordAudit({ actorUserId: req.user.id, actorRole: req.user.role, orgId: req.scopedOrgId, action: 'user.delete', targetType: 'user', targetId: target.id, ip: req.ip });
    res.json({ message: 'User deleted' });
  } catch (err) {
    next(err);
  }
});

router.get('/trips', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT t.*, u.username as leader_username, (SELECT COUNT(*)::int FROM trip_members tm WHERE tm.trip_id = t.id) as member_count
       FROM trips t JOIN users u ON u.id = t.leader_id WHERE t.org_id = $1 ORDER BY t.created_at DESC LIMIT 200`,
      [req.scopedOrgId]
    );
    res.json({ trips: r.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/trips/:id/cancel', async (req, res, next) => {
  try {
    const t = await query('SELECT * FROM trips WHERE id = $1 AND org_id = $2', [req.params.id, req.scopedOrgId]);
    if (!t.rows[0]) return res.status(404).json({ error: 'Trip not found in this organization' });
    await query(`UPDATE trips SET status='cancelled' WHERE id=$1`, [req.params.id]);
    await recordAudit({ actorUserId: req.user.id, actorRole: req.user.role, orgId: req.scopedOrgId, action: 'trip.cancel', targetType: 'trip', targetId: req.params.id, ip: req.ip });
    res.json({ message: 'Trip cancelled' });
  } catch (err) {
    next(err);
  }
});

router.delete('/trips/:id', async (req, res, next) => {
  try {
    const t = await query('SELECT * FROM trips WHERE id = $1 AND org_id = $2', [req.params.id, req.scopedOrgId]);
    if (!t.rows[0]) return res.status(404).json({ error: 'Trip not found in this organization' });
    await query('DELETE FROM trips WHERE id = $1', [req.params.id]);
    await recordAudit({ actorUserId: req.user.id, actorRole: req.user.role, orgId: req.scopedOrgId, action: 'trip.delete', targetType: 'trip', targetId: req.params.id, ip: req.ip });
    res.json({ message: 'Trip deleted' });
  } catch (err) {
    next(err);
  }
});

router.get('/riders/active', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT u.id, u.username, u.name, l.lat, l.lng, l.updated_at FROM locations l JOIN users u ON u.id = l.user_id
       WHERE l.org_id = $1 AND l.is_live = true`,
      [req.scopedOrgId]
    );
    res.json({ riders: r.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
