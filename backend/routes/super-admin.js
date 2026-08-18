const express = require('express');
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../db/pool');
const { authRequired, requireSuperAdmin } = require('../middleware/auth');
const { revokeAllUserTokens } = require('../utils/tokens');
const { recordAudit } = require('../utils/audit');

const router = express.Router();
router.use(authRequired, requireSuperAdmin);

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

// ===== Platform overview =====
router.get('/summary', async (req, res, next) => {
  try {
    const totalOrgs = (await query(`SELECT COUNT(*)::int c FROM organizations`)).rows[0].c;
    const activeOrgs = (await query(`SELECT COUNT(*)::int c FROM organizations WHERE status='active'`)).rows[0].c;
    const disabledOrgs = (await query(`SELECT COUNT(*)::int c FROM organizations WHERE status='disabled'`)).rows[0].c;
    const totalUsers = (await query(`SELECT COUNT(*)::int c FROM users WHERE role != 'super_admin'`)).rows[0].c;
    const liveRiders = (await query(`SELECT COUNT(*)::int c FROM locations WHERE is_live = true`)).rows[0].c;
    const totalTrips = (await query(`SELECT COUNT(*)::int c FROM trips`)).rows[0].c;
    const activeTrips = (await query(`SELECT COUNT(*)::int c FROM trips WHERE status='active'`)).rows[0].c;
    const planDistribution = await query(
      `SELECT p.code, p.name, COUNT(s.id)::int as org_count FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status IN ('active','trial','manual')
       GROUP BY p.id ORDER BY p.name`
    );
    res.json({ totalOrgs, activeOrgs, disabledOrgs, totalUsers, liveRiders, totalTrips, activeTrips, planDistribution: planDistribution.rows });
  } catch (err) {
    next(err);
  }
});

// ===== Organizations =====
router.get('/organizations', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const r = q
      ? await query(
          `SELECT o.*, (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id) as user_count
           FROM organizations o WHERE o.name ILIKE $1 OR o.slug ILIKE $1 ORDER BY o.created_at DESC`,
          [`%${q}%`]
        )
      : await query(
          `SELECT o.*, (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id) as user_count FROM organizations o ORDER BY o.created_at DESC`
        );
    res.json({ organizations: r.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/organizations', async (req, res, next) => {
  try {
    const { name, slug } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });
    const cleanSlug = slug.trim().toLowerCase();
    if (!SLUG_RE.test(cleanSlug)) {
      return res.status(400).json({ error: 'slug must be 3-40 chars: lowercase letters, numbers, hyphens' });
    }

    const existing = await query('SELECT id FROM organizations WHERE slug = $1', [cleanSlug]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'That org code is already taken' });

    const ins = await query(`INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING *`, [name.trim(), cleanSlug]);
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', orgId: ins.rows[0].id, action: 'org.create', targetType: 'organization', targetId: ins.rows[0].id, metadata: { name, slug: cleanSlug }, ip: req.ip });
    res.status(201).json({ organization: ins.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/organizations/:id', async (req, res, next) => {
  try {
    const orgRes = await query('SELECT * FROM organizations WHERE id = $1', [req.params.id]);
    if (!orgRes.rows[0]) return res.status(404).json({ error: 'Organization not found' });

    const userCount = (await query('SELECT COUNT(*)::int c FROM users WHERE org_id = $1', [req.params.id])).rows[0].c;
    const tripCount = (await query('SELECT COUNT(*)::int c FROM trips WHERE org_id = $1', [req.params.id])).rows[0].c;
    const liveRiders = (await query('SELECT COUNT(*)::int c FROM locations WHERE org_id = $1 AND is_live = true', [req.params.id])).rows[0].c;
    const admins = await query(`SELECT id, username, name, email, status FROM users WHERE org_id = $1 AND role = 'org_admin'`, [req.params.id]);
    const subscription = await query(
      `SELECT s.*, p.name as plan_name, p.code as plan_code FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.org_id = $1 ORDER BY s.created_at DESC LIMIT 1`,
      [req.params.id]
    );

    res.json({
      organization: orgRes.rows[0],
      stats: { userCount, tripCount, liveRiders },
      admins: admins.rows,
      subscription: subscription.rows[0] || null
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/organizations/:id', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    const r = await query(`UPDATE organizations SET name = COALESCE($1, name) WHERE id = $2 RETURNING *`, [name, req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Organization not found' });
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', orgId: req.params.id, action: 'org.update', targetType: 'organization', targetId: req.params.id, metadata: { name }, ip: req.ip });
    res.json({ organization: r.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/organizations/:id/activate', async (req, res, next) => {
  try {
    const r = await query(`UPDATE organizations SET status='active' WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Organization not found' });
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', orgId: req.params.id, action: 'org.activate', targetType: 'organization', targetId: req.params.id, ip: req.ip });
    res.json({ message: 'Organization activated' });
  } catch (err) {
    next(err);
  }
});

router.post('/organizations/:id/deactivate', async (req, res, next) => {
  try {
    const r = await query(`UPDATE organizations SET status='disabled' WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Organization not found' });
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', orgId: req.params.id, action: 'org.deactivate', targetType: 'organization', targetId: req.params.id, ip: req.ip });
    res.json({ message: 'Organization deactivated -- its members can no longer log in' });
  } catch (err) {
    next(err);
  }
});

// Create a brand new user directly as that org's admin (super admin bootstrapping a new org).
router.post('/organizations/:id/admins', async (req, res, next) => {
  try {
    const orgRes = await query('SELECT * FROM organizations WHERE id = $1', [req.params.id]);
    if (!orgRes.rows[0]) return res.status(404).json({ error: 'Organization not found' });

    const { username, name, email, phone, password } = req.body || {};
    if (!username || !name || !email || !phone || !password) {
      return res.status(400).json({ error: 'username, name, email, phone and password are all required' });
    }
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Invalid username format' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const clash = await query(
      `SELECT id FROM users WHERE org_id = $1 AND (username = $2 OR email = $3 OR phone = $4)`,
      [req.params.id, username, email, phone]
    );
    if (clash.rows.length > 0) return res.status(409).json({ error: 'Username, email or phone already in use in this organization' });

    const password_hash = await bcrypt.hash(password, 12);
    const user = await withTransaction(async (client) => {
      const ures = await client.query(
        `INSERT INTO users (org_id, username, name, phone, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6, 'org_admin') RETURNING *`,
        [req.params.id, username, name, phone, email, password_hash]
      );
      await client.query('INSERT INTO locations (user_id, org_id, is_live) VALUES ($1, $2, false)', [ures.rows[0].id, req.params.id]);
      return ures.rows[0];
    });

    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', orgId: req.params.id, action: 'org_admin.create', targetType: 'user', targetId: user.id, metadata: { username }, ip: req.ip });
    res.status(201).json({ user: { id: user.id, username: user.username, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
});

// Promote an existing member of that org to org_admin instead of creating a new account.
router.post('/organizations/:id/admins/promote/:userId', async (req, res, next) => {
  try {
    const target = await query('SELECT * FROM users WHERE id = $1 AND org_id = $2', [req.params.userId, req.params.id]);
    if (!target.rows[0]) return res.status(404).json({ error: 'User not found in this organization' });

    await query(`UPDATE users SET role='org_admin' WHERE id=$1`, [req.params.userId]);
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', orgId: req.params.id, action: 'org_admin.promote', targetType: 'user', targetId: req.params.userId, ip: req.ip });
    res.json({ message: 'User promoted to organization admin' });
  } catch (err) {
    next(err);
  }
});

router.post('/organizations/:id/admins/demote/:userId', async (req, res, next) => {
  try {
    const target = await query('SELECT * FROM users WHERE id = $1 AND org_id = $2', [req.params.userId, req.params.id]);
    if (!target.rows[0]) return res.status(404).json({ error: 'User not found in this organization' });

    await query(`UPDATE users SET role='member' WHERE id=$1`, [req.params.userId]);
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', orgId: req.params.id, action: 'org_admin.demote', targetType: 'user', targetId: req.params.userId, ip: req.ip });
    res.json({ message: 'Organization admin demoted to member' });
  } catch (err) {
    next(err);
  }
});

// ===== Platform-wide user search (across every organization) =====
router.get('/users', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const r = q
      ? await query(
          `SELECT u.id, u.username, u.name, u.email, u.phone, u.role, u.status, u.created_at, o.name as org_name, o.slug as org_slug
           FROM users u LEFT JOIN organizations o ON o.id = u.org_id
           WHERE u.username ILIKE $1 OR u.name ILIKE $1 OR u.email ILIKE $1 OR u.phone ILIKE $1
           ORDER BY u.created_at DESC LIMIT 200`,
          [`%${q}%`]
        )
      : await query(
          `SELECT u.id, u.username, u.name, u.email, u.phone, u.role, u.status, u.created_at, o.name as org_name, o.slug as org_slug
           FROM users u LEFT JOIN organizations o ON o.id = u.org_id ORDER BY u.created_at DESC LIMIT 200`
        );
    res.json({ users: r.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/disable', async (req, res, next) => {
  try {
    const r = await query(`UPDATE users SET status='disabled' WHERE id=$1 RETURNING org_id`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
    await revokeAllUserTokens(req.params.id);
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', orgId: r.rows[0].org_id, action: 'user.disable', targetType: 'user', targetId: req.params.id, ip: req.ip });
    res.json({ message: 'Account disabled' });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/enable', async (req, res, next) => {
  try {
    const r = await query(`UPDATE users SET status='active' WHERE id=$1 RETURNING org_id`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', orgId: r.rows[0].org_id, action: 'user.enable', targetType: 'user', targetId: req.params.id, ip: req.ip });
    res.json({ message: 'Account enabled' });
  } catch (err) {
    next(err);
  }
});

// ===== Audit log =====
router.get('/audit-logs', async (req, res, next) => {
  try {
    const orgFilter = req.query.org_id;
    const r = orgFilter
      ? await query(`SELECT * FROM audit_logs WHERE org_id = $1 ORDER BY created_at DESC LIMIT 300`, [orgFilter])
      : await query(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 300`);
    res.json({ logs: r.rows });
  } catch (err) {
    next(err);
  }
});

// ===== Subscriptions & plans (dormant while MONETIZATION_ENABLED=false, but fully
// manageable now so the workflow exists before enforcement is switched on) =====
router.get('/plans', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM plans ORDER BY created_at ASC');
    res.json({ plans: r.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/plans', async (req, res, next) => {
  try {
    const { code, name, description, features, limits, price_cents, currency, billing_interval } = req.body || {};
    if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
    const ins = await query(
      `INSERT INTO plans (code, name, description, features, limits, price_cents, currency, billing_interval)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [code, name, description || '', JSON.stringify(features || {}), JSON.stringify(limits || {}), price_cents || 0, currency || 'INR', billing_interval || 'month']
    );
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', action: 'plan.create', targetType: 'plan', targetId: ins.rows[0].id, metadata: { code }, ip: req.ip });
    res.status(201).json({ plan: ins.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/plans/:id', async (req, res, next) => {
  try {
    const { name, description, features, limits, price_cents, is_active } = req.body || {};
    const r = await query(
      `UPDATE plans SET
        name = COALESCE($1, name), description = COALESCE($2, description),
        features = COALESCE($3, features), limits = COALESCE($4, limits),
        price_cents = COALESCE($5, price_cents), is_active = COALESCE($6, is_active)
       WHERE id = $7 RETURNING *`,
      [name, description, features ? JSON.stringify(features) : null, limits ? JSON.stringify(limits) : null, price_cents, is_active, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Plan not found' });
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', action: 'plan.update', targetType: 'plan', targetId: req.params.id, ip: req.ip });
    res.json({ plan: r.rows[0] });
  } catch (err) {
    next(err);
  }
});

// Assign/override a plan for an organization (manual grant, trial, etc.)
router.post('/organizations/:id/subscription', async (req, res, next) => {
  try {
    const { plan_id, status, trial_ends_at, expires_at, notes } = req.body || {};
    if (!plan_id || !status) return res.status(400).json({ error: 'plan_id and status are required' });

    const ins = await query(
      `INSERT INTO subscriptions (org_id, plan_id, status, trial_ends_at, expires_at, granted_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.id, plan_id, status, trial_ends_at || null, expires_at || null, req.user.id, notes || null]
    );
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', orgId: req.params.id, action: 'subscription.assign', targetType: 'organization', targetId: req.params.id, metadata: { plan_id, status }, ip: req.ip });
    res.status(201).json({ subscription: ins.rows[0] });
  } catch (err) {
    next(err);
  }
});

// Grant an individual user a plan override (e.g. Pro while their org stays on Community)
router.post('/users/:id/entitlement-override', async (req, res, next) => {
  try {
    const { plan_id, reason, expires_at } = req.body || {};
    if (!plan_id) return res.status(400).json({ error: 'plan_id is required' });
    const ins = await query(
      `INSERT INTO user_entitlement_overrides (user_id, plan_id, reason, granted_by, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, plan_id, reason || null, req.user.id, expires_at || null]
    );
    await recordAudit({ actorUserId: req.user.id, actorRole: 'super_admin', action: 'entitlement.override', targetType: 'user', targetId: req.params.id, metadata: { plan_id, reason }, ip: req.ip });
    res.status(201).json({ override: ins.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
