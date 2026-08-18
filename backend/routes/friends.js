const express = require('express');
const { query } = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { serializeUser, areFriends, addFriendship, createNotification } = require('../utils/helpers');

module.exports = function friendsRouter(io) {
  const router = express.Router();

  router.post('/requests', authRequired, async (req, res, next) => {
    try {
      const { receiver_id } = req.body || {};
      if (!receiver_id) return res.status(400).json({ error: 'receiver_id is required' });
      if (receiver_id === req.user.id) return res.status(400).json({ error: "You can't friend yourself" });

      // Receiver must exist within the SAME organization -- cross-org friend requests
      // are the core tenant-isolation rule for the social graph.
      const rRes = await query(`SELECT * FROM users WHERE id = $1 AND org_id = $2`, [receiver_id, req.user.org_id]);
      const receiver = rRes.rows[0];
      if (!receiver) return res.status(404).json({ error: 'User not found in your organization' });

      if (await areFriends(req.user.id, receiver_id)) {
        return res.status(409).json({ error: 'Already friends' });
      }

      const existingRes = await query(
        `SELECT * FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
        [req.user.id, receiver_id]
      );
      const existing = existingRes.rows[0];
      if (existing && existing.status === 'pending') {
        return res.status(409).json({ error: 'A friend request is already pending between you' });
      }

      let requestRow;
      if (existing) {
        const upd = await query(
          `UPDATE friend_requests SET status = 'pending', sender_id = $1, receiver_id = $2, updated_at = now() WHERE id = $3 RETURNING *`,
          [req.user.id, receiver_id, existing.id]
        );
        requestRow = upd.rows[0];
      } else {
        const ins = await query(
          `INSERT INTO friend_requests (org_id, sender_id, receiver_id) VALUES ($1, $2, $3) RETURNING *`,
          [req.user.org_id, req.user.id, receiver_id]
        );
        requestRow = ins.rows[0];
      }

      const notif = await createNotification(
        req.user.org_id,
        receiver_id,
        'friend_request',
        `${req.user.name} (@${req.user.username}) sent you a friend request`,
        requestRow.id
      );
      io.to(`user:${receiver_id}`).emit('notification:new', notif);
      io.to(`user:${receiver_id}`).emit('friend:request:incoming', requestRow);

      res.status(201).json({ request: requestRow });
    } catch (err) {
      next(err);
    }
  });

  router.get('/requests', authRequired, async (req, res, next) => {
    try {
      const incoming = await query(
        `SELECT fr.*, u.username, u.name, u.profile_pic_path FROM friend_requests fr
         JOIN users u ON u.id = fr.sender_id
         WHERE fr.receiver_id = $1 AND fr.status = 'pending'`,
        [req.user.id]
      );
      const outgoing = await query(
        `SELECT fr.*, u.username, u.name, u.profile_pic_path FROM friend_requests fr
         JOIN users u ON u.id = fr.receiver_id
         WHERE fr.sender_id = $1 AND fr.status = 'pending'`,
        [req.user.id]
      );
      res.json({ incoming: incoming.rows, outgoing: outgoing.rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/requests/:id/respond', authRequired, async (req, res, next) => {
    try {
      const { action } = req.body || {};
      const r = await query('SELECT * FROM friend_requests WHERE id = $1', [req.params.id]);
      const request = r.rows[0];
      if (!request) return res.status(404).json({ error: 'Request not found' });
      if (request.receiver_id !== req.user.id) return res.status(403).json({ error: 'Not your request to respond to' });
      if (request.status !== 'pending') return res.status(409).json({ error: 'Request already handled' });
      if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: "action must be 'accept' or 'reject'" });

      const newStatus = action === 'accept' ? 'accepted' : 'rejected';
      await query(`UPDATE friend_requests SET status = $1, updated_at = now() WHERE id = $2`, [newStatus, request.id]);

      if (action === 'accept') {
        await addFriendship(req.user.org_id, request.sender_id, request.receiver_id);
        const notif = await createNotification(
          req.user.org_id,
          request.sender_id,
          'friend_accept',
          `${req.user.name} (@${req.user.username}) accepted your friend request`,
          request.id
        );
        io.to(`user:${request.sender_id}`).emit('notification:new', notif);
        io.to(`user:${request.sender_id}`).emit('friend:request:accepted', { by: req.user.id });
      }

      res.json({ message: `Request ${newStatus}` });
    } catch (err) {
      next(err);
    }
  });

  router.get('/', authRequired, async (req, res, next) => {
    try {
      const r = await query(
        `SELECT u.* FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_id_1 = $1 THEN f.user_id_2 ELSE f.user_id_1 END
         WHERE f.user_id_1 = $1 OR f.user_id_2 = $1`,
        [req.user.id]
      );
      const friends = await Promise.all(r.rows.map((u) => serializeUser(u, req.user)));
      res.json({ friends });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:friendId', authRequired, async (req, res, next) => {
    try {
      const friendId = req.params.friendId;
      const [u1, u2] = req.user.id < friendId ? [req.user.id, friendId] : [friendId, req.user.id];
      await query('DELETE FROM friendships WHERE user_id_1 = $1 AND user_id_2 = $2', [u1, u2]);
      await query(
        `DELETE FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
        [req.user.id, friendId]
      );
      res.json({ message: 'Friend removed' });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
