const express = require('express');
const fs = require('fs');
const { query } = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { profilePicAbsolutePath } = require('../middleware/upload');

const router = express.Router();

// <img> tags can't send an Authorization header, so this route also accepts the access
// token as a ?token= query param -- but ONLY for this GET/image route, and it goes through
// the exact same verification as the header path. Nothing else on the API accepts this.
function authViaHeaderOrQuery(req, res, next) {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  return authRequired(req, res, next);
}

// Only authenticated users within the same organization (or a super_admin) may view a
// profile picture -- this mirrors the same tenant-isolation rule as everything else,
// since these files are stored outside the public web root specifically so Nginx/Express
// static serving can't accidentally expose them without going through this auth check.
router.get('/profile-pics/:userId', authViaHeaderOrQuery, async (req, res, next) => {
  try {
    const r = await query('SELECT org_id, profile_pic_path FROM users WHERE id = $1', [req.params.userId]);
    const target = r.rows[0];
    if (!target || !target.profile_pic_path) return res.status(404).json({ error: 'No profile picture' });

    const sameOrg = req.user.role === 'super_admin' || req.user.org_id === target.org_id;
    if (!sameOrg) return res.status(403).json({ error: 'Not authorized to view this image' });

    const absPath = profilePicAbsolutePath(target.profile_pic_path);
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Image file missing' });

    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(absPath);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
