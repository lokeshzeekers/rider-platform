const express = require('express');
const { query } = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { serializeUser, areFriends, haversineKm } = require('../utils/helpers');
const { upload, processAndSaveProfilePic } = require('../middleware/upload');

const router = express.Router();

// Search within the caller's own organization only -- tenant isolation enforced by
// filtering every query on req.user.org_id, not by trusting any client-supplied org id.
router.get('/search', authRequired, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 1) return res.json({ results: [] });

    const like = `%${q}%`;
    const r = await query(
      `SELECT * FROM users WHERE org_id = $1 AND (username ILIKE $2 OR name ILIKE $2) AND id != $3 AND status = 'active' LIMIT 25`,
      [req.user.org_id, like, req.user.id]
    );
    const results = await Promise.all(r.rows.map((u) => serializeUser(u, req.user)));
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authRequired, async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM users WHERE id = $1 AND org_id = $2', [req.params.id, req.user.org_id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: await serializeUser(r.rows[0], req.user) });
  } catch (err) {
    next(err);
  }
});

router.patch('/me/update', authRequired, async (req, res, next) => {
  try {
    const { name, bio } = req.body || {};
    const r = await query(
      `UPDATE users SET name = COALESCE($1, name), bio = COALESCE($2, bio) WHERE id = $3 RETURNING *`,
      [name, bio, req.user.id]
    );
    res.json({ user: await serializeUser(r.rows[0], req.user) });
  } catch (err) {
    next(err);
  }
});

// Profile picture upload: validated + re-encoded by sharp, stored outside the web root,
// served only via the authenticated /api/uploads/profile-pics/:userId route.
router.post('/me/profile-pic', authRequired, upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided (field name: photo)' });
    const relPath = await processAndSaveProfilePic(req.file.buffer, req.user.id);
    await query('UPDATE users SET profile_pic_path = $1 WHERE id = $2', [relPath, req.user.id]);
    res.json({ profile_pic_url: `/api/uploads/profile-pics/${req.user.id}` });
  } catch (err) {
    if (err.message && err.message.includes('Only JPEG')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/me/location', authRequired, async (req, res, next) => {
  try {
    const { lat, lng, is_live } = req.body || {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng (numbers) are required' });
    }
    await query(
      `INSERT INTO locations (user_id, org_id, lat, lng, is_live, updated_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, is_live = excluded.is_live, updated_at = now()`,
      [req.user.id, req.user.org_id, lat, lng, is_live === false ? false : true]
    );
    res.json({ message: 'Location updated' });
  } catch (err) {
    next(err);
  }
});

router.post('/me/location/stop', authRequired, async (req, res, next) => {
  try {
    await query(`UPDATE locations SET is_live = false, updated_at = now() WHERE user_id = $1`, [req.user.id]);
    res.json({ message: 'Live sharing stopped' });
  } catch (err) {
    next(err);
  }
});

// Nearby/active riders -- scoped to the same organization only.
router.get('/nearby/active', authRequired, async (req, res, next) => {
  try {
    const myLocRes = await query('SELECT lat, lng FROM locations WHERE user_id = $1 AND is_live = true', [req.user.id]);
    const myLoc = myLocRes.rows[0];

    const r = await query(
      `SELECT u.id, u.username, u.name, u.profile_pic_path, l.lat, l.lng, l.updated_at
       FROM locations l JOIN users u ON u.id = l.user_id
       WHERE l.is_live = true AND u.org_id = $1 AND u.id != $2 AND u.status = 'active'`,
      [req.user.org_id, req.user.id]
    );

    const results = await Promise.all(
      r.rows.map(async (row) => {
        const distance_km = myLoc && myLoc.lat != null ? haversineKm(myLoc.lat, myLoc.lng, row.lat, row.lng) : null;
        return {
          id: row.id,
          username: row.username,
          name: row.name,
          profile_pic_url: row.profile_pic_path ? `/api/uploads/profile-pics/${row.id}` : null,
          lat: row.lat,
          lng: row.lng,
          updated_at: row.updated_at,
          is_friend: await areFriends(req.user.id, row.id),
          distance_km: distance_km !== null ? Math.round(distance_km * 10) / 10 : null
        };
      })
    );
    results.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

router.get('/me/friends-locations', authRequired, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT u.id, u.username, u.name, u.profile_pic_path, l.lat, l.lng, l.is_live, l.updated_at
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_id_1 = $1 THEN f.user_id_2 ELSE f.user_id_1 END
       LEFT JOIN locations l ON l.user_id = u.id
       WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1) AND u.org_id = $2`,
      [req.user.id, req.user.org_id]
    );
    res.json({ results: r.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
