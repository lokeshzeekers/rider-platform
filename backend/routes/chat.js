const express = require('express');
const { query } = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { areFriends, createNotification } = require('../utils/helpers');

module.exports = function chatRouter(io) {
  const router = express.Router();

  router.get('/threads', authRequired, async (req, res, next) => {
    try {
      const r = await query(
        `SELECT u.id, u.username, u.name, u.profile_pic_path,
                (SELECT content FROM messages m WHERE (m.sender_id=u.id AND m.receiver_id=$1) OR (m.sender_id=$1 AND m.receiver_id=u.id)
                 ORDER BY m.created_at DESC LIMIT 1) as last_message,
                (SELECT created_at FROM messages m WHERE (m.sender_id=u.id AND m.receiver_id=$1) OR (m.sender_id=$1 AND m.receiver_id=u.id)
                 ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
                (SELECT COUNT(*)::int FROM messages m WHERE m.sender_id=u.id AND m.receiver_id=$1 AND m.read=false) as unread_count
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_id_1 = $1 THEN f.user_id_2 ELSE f.user_id_1 END
         WHERE f.user_id_1 = $1 OR f.user_id_2 = $1
         ORDER BY last_message_at DESC NULLS LAST`,
        [req.user.id]
      );
      res.json({ threads: r.rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/with/:userId', authRequired, async (req, res, next) => {
    try {
      const otherId = req.params.userId;
      if (!(await areFriends(req.user.id, otherId))) {
        return res.status(403).json({ error: 'You can only chat with friends' });
      }
      const r = await query(
        `SELECT * FROM messages WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1) ORDER BY created_at ASC`,
        [req.user.id, otherId]
      );
      await query(`UPDATE messages SET read=true WHERE sender_id=$1 AND receiver_id=$2 AND read=false`, [otherId, req.user.id]);
      res.json({ messages: r.rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/with/:userId', authRequired, async (req, res, next) => {
    try {
      const otherId = req.params.userId;
      const { content } = req.body || {};
      if (!content || !content.trim()) return res.status(400).json({ error: 'content is required' });
      if (content.length > 4000) return res.status(400).json({ error: 'Message too long' });
      if (!(await areFriends(req.user.id, otherId))) {
        return res.status(403).json({ error: 'You can only chat with friends' });
      }

      const ins = await query(
        `INSERT INTO messages (org_id, sender_id, receiver_id, content) VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.user.org_id, req.user.id, otherId, content.trim()]
      );
      const message = ins.rows[0];

      io.to(`user:${otherId}`).emit('chat:message', message);
      const notif = await createNotification(req.user.org_id, otherId, 'chat', `New message from ${req.user.name}`, req.user.id);
      io.to(`user:${otherId}`).emit('notification:new', notif);

      res.status(201).json({ message });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
