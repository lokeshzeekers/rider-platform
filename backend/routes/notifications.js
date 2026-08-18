const express = require('express');
const { query } = require('../db/pool');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    res.json({ notifications: r.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', authRequired, async (req, res, next) => {
  try {
    await query('UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Marked as read' });
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', authRequired, async (req, res, next) => {
  try {
    await query('UPDATE notifications SET read = true WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'All marked as read' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
