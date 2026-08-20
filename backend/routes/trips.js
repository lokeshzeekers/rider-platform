const express = require('express');
const { query, withTransaction } = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { areFriends, createNotification, haversineKm } = require('../utils/helpers');

async function isMember(tripId, userId) {
  const r = await query('SELECT 1 FROM trip_members WHERE trip_id=$1 AND user_id=$2', [tripId, userId]);
  return r.rows.length > 0;
}
function isLeader(trip, userId) {
  return trip && trip.leader_id === userId;
}
async function getTripInOrg(tripId, orgId) {
  const r = await query('SELECT * FROM trips WHERE id = $1 AND org_id = $2', [tripId, orgId]);
  return r.rows[0] || null;
}

// Shared by trip creation and both the start/destination pin editors: coordinates are
// only ever accepted as an explicit numeric pair (typed in, or the device's own
// geolocation) supplied by the client -- never derived/geocoded from place-name text.
// Returns { ok:true, lat, lng } | { ok:true, lat:null, lng:null } (both omitted/cleared)
// | { ok:false, error }.
function validateCoordPair(lat, lng, { allowClear = false } = {}) {
  const latProvided = lat !== undefined && lat !== null;
  const lngProvided = lng !== undefined && lng !== null;
  if (!latProvided && !lngProvided) {
    return { ok: true, lat: null, lng: null };
  }
  if (allowClear && lat === null && lng === null) {
    return { ok: true, lat: null, lng: null };
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return { ok: false, error: 'Both latitude and longitude must be numbers if either is provided' };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: 'Latitude/longitude out of range' };
  }
  return { ok: true, lat, lng };
}

module.exports = function tripsRouter(io) {
  const router = express.Router();

  router.post('/', authRequired, async (req, res, next) => {
    try {
      const { name, start_point, destination, trip_date, trip_time, description, invite_user_ids, dest_lat, dest_lng, start_lat, start_lng } = req.body || {};
      if (!name || !start_point || !destination || !trip_date || !trip_time) {
        return res.status(400).json({ error: 'name, start_point, destination, trip_date and trip_time are required' });
      }

      const destCoords = validateCoordPair(dest_lat, dest_lng);
      if (!destCoords.ok) return res.status(400).json({ error: destCoords.error });
      const startCoords = validateCoordPair(start_lat, start_lng);
      if (!startCoords.ok) return res.status(400).json({ error: startCoords.error });

      const trip = await withTransaction(async (client) => {
        const ins = await client.query(
          `INSERT INTO trips (org_id, name, start_point, destination, trip_date, trip_time, description, leader_id, dest_lat, dest_lng, start_lat, start_lng)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
          [req.user.org_id, name, start_point, destination, trip_date, trip_time, description || '', req.user.id, destCoords.lat, destCoords.lng, startCoords.lat, startCoords.lng]
        );
        const t = ins.rows[0];
        await client.query('INSERT INTO trip_members (trip_id, user_id) VALUES ($1, $2)', [t.id, req.user.id]);
        return t;
      });

      if (Array.isArray(invite_user_ids)) {
        for (const uid of invite_user_ids) {
          if (uid === req.user.id) continue;
          // Invitees must be friends AND in the same org -- areFriends alone already implies
          // same-org since friendships are only ever created within an org, but we double
          // check org membership explicitly as defense in depth.
          const targetRes = await query('SELECT id FROM users WHERE id = $1 AND org_id = $2', [uid, req.user.org_id]);
          if (!targetRes.rows[0]) continue;
          if (!(await areFriends(req.user.id, uid))) continue;

          await query(
            `INSERT INTO trip_invitations (trip_id, user_id, invited_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [trip.id, uid, req.user.id]
          );
          const notif = await createNotification(req.user.org_id, uid, 'trip_invite', `${req.user.name} invited you to trip "${trip.name}"`, trip.id);
          io.to(`user:${uid}`).emit('notification:new', notif);
          io.to(`user:${uid}`).emit('trip:invite:incoming', { trip_id: trip.id, trip_name: trip.name });
        }
      }

      res.status(201).json({ trip });
    } catch (err) {
      next(err);
    }
  });

  router.get('/mine', authRequired, async (req, res, next) => {
    try {
      const active = await query(
        `SELECT t.* FROM trips t JOIN trip_members tm ON tm.trip_id = t.id
         WHERE tm.user_id = $1 AND t.org_id = $2 ORDER BY t.trip_date DESC, t.trip_time DESC`,
        [req.user.id, req.user.org_id]
      );
      const invitations = await query(
        `SELECT ti.*, t.name, t.start_point, t.destination, t.trip_date, t.trip_time, u.name as invited_by_name
         FROM trip_invitations ti
         JOIN trips t ON t.id = ti.trip_id
         JOIN users u ON u.id = ti.invited_by
         WHERE ti.user_id = $1 AND ti.status = 'pending' AND t.org_id = $2`,
        [req.user.id, req.user.org_id]
      );
      res.json({ trips: active.rows, invitations: invitations.rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', authRequired, async (req, res, next) => {
    try {
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      if (!(await isMember(trip.id, req.user.id))) return res.status(403).json({ error: 'Not a member of this trip' });

      const members = await query(
        `SELECT u.id, u.username, u.name, u.profile_pic_path, tm.is_sharing_location, tm.joined_at, tm.reached_at
         FROM trip_members tm JOIN users u ON u.id = tm.user_id WHERE tm.trip_id = $1`,
        [trip.id]
      );
      const invitations = await query(
        `SELECT ti.*, u.username, u.name FROM trip_invitations ti JOIN users u ON u.id = ti.user_id WHERE ti.trip_id = $1`,
        [trip.id]
      );
      const historyRes = await query('SELECT * FROM trip_history WHERE trip_id = $1', [trip.id]);

      res.json({
        trip,
        members: members.rows,
        invitations: invitations.rows,
        history: historyRes.rows[0] || null,
        is_leader: isLeader(trip, req.user.id)
      });
    } catch (err) {
      next(err);
    }
  });

  // Leader-only: set, update, or clear the trip's real destination coordinates.
  router.patch('/:id/destination', authRequired, async (req, res, next) => {
    try {
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      if (!isLeader(trip, req.user.id)) return res.status(403).json({ error: 'Only the trip leader can set destination coordinates' });

      const { dest_lat, dest_lng } = req.body || {};
      const coords = validateCoordPair(dest_lat, dest_lng, { allowClear: true });
      if (!coords.ok) return res.status(400).json({ error: coords.error });

      const r = await query('UPDATE trips SET dest_lat = $1, dest_lng = $2 WHERE id = $3 RETURNING *', [coords.lat, coords.lng, trip.id]);
      io.to(`trip:${trip.id}`).emit('trip:destination:update', { trip_id: trip.id, dest_lat: r.rows[0].dest_lat, dest_lng: r.rows[0].dest_lng });
      res.json({ trip: r.rows[0] });
    } catch (err) {
      next(err);
    }
  });

  // Leader-only: set, update, or clear the trip's real start coordinates. Symmetric to
  // the destination endpoint above.
  router.patch('/:id/start-point', authRequired, async (req, res, next) => {
    try {
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      if (!isLeader(trip, req.user.id)) return res.status(403).json({ error: 'Only the trip leader can set the start point' });

      const { start_lat, start_lng } = req.body || {};
      const coords = validateCoordPair(start_lat, start_lng, { allowClear: true });
      if (!coords.ok) return res.status(400).json({ error: coords.error });

      const r = await query('UPDATE trips SET start_lat = $1, start_lng = $2 WHERE id = $3 RETURNING *', [coords.lat, coords.lng, trip.id]);
      io.to(`trip:${trip.id}`).emit('trip:start-point:update', { trip_id: trip.id, start_lat: r.rows[0].start_lat, start_lng: r.rows[0].start_lng });
      res.json({ trip: r.rows[0] });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/invite', authRequired, async (req, res, next) => {
    try {
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      if (!isLeader(trip, req.user.id)) return res.status(403).json({ error: 'Only the trip leader can invite' });

      const { user_ids } = req.body || {};
      if (!Array.isArray(user_ids) || user_ids.length === 0) {
        return res.status(400).json({ error: 'user_ids (array) is required' });
      }

      const invited = [];
      for (const uid of user_ids) {
        if (uid === req.user.id || (await isMember(trip.id, uid))) continue;
        const targetRes = await query('SELECT id FROM users WHERE id = $1 AND org_id = $2', [uid, req.user.org_id]);
        if (!targetRes.rows[0]) continue;
        if (!(await areFriends(req.user.id, uid))) continue;

        await query(`INSERT INTO trip_invitations (trip_id, user_id, invited_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [trip.id, uid, req.user.id]);
        const notif = await createNotification(req.user.org_id, uid, 'trip_invite', `${req.user.name} invited you to trip "${trip.name}"`, trip.id);
        io.to(`user:${uid}`).emit('notification:new', notif);
        io.to(`user:${uid}`).emit('trip:invite:incoming', { trip_id: trip.id, trip_name: trip.name });
        invited.push(uid);
      }
      res.json({ invited });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/invitations/respond', authRequired, async (req, res, next) => {
    try {
      const { action } = req.body || {};
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });

      const invRes = await query('SELECT * FROM trip_invitations WHERE trip_id = $1 AND user_id = $2', [trip.id, req.user.id]);
      const invite = invRes.rows[0];
      if (!invite || invite.status !== 'pending') return res.status(404).json({ error: 'No pending invitation found' });
      if (!['accept', 'decline'].includes(action)) return res.status(400).json({ error: "action must be 'accept' or 'decline'" });

      const newStatus = action === 'accept' ? 'accepted' : 'declined';
      await query('UPDATE trip_invitations SET status = $1 WHERE id = $2', [newStatus, invite.id]);

      if (action === 'accept') {
        await query('INSERT INTO trip_members (trip_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [trip.id, req.user.id]);
        io.to(`trip:${trip.id}`).emit('trip:member:joined', { trip_id: trip.id, user_id: req.user.id, name: req.user.name });
      }
      const notif = await createNotification(
        req.user.org_id,
        trip.leader_id,
        'trip_update',
        `${req.user.name} ${newStatus === 'accepted' ? 'joined' : 'declined'} trip "${trip.name}"`,
        trip.id
      );
      io.to(`user:${trip.leader_id}`).emit('notification:new', notif);

      res.json({ message: `Invitation ${newStatus}` });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/location', authRequired, async (req, res, next) => {
    try {
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      if (!(await isMember(trip.id, req.user.id))) return res.status(403).json({ error: 'Not a member of this trip' });

      const { lat, lng } = req.body || {};
      if (typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'lat and lng are required' });

      await query(
        `INSERT INTO trip_locations (trip_id, user_id, lat, lng, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (trip_id, user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, updated_at = now()`,
        [trip.id, req.user.id, lat, lng]
      );
      await query('UPDATE trip_members SET is_sharing_location = true WHERE trip_id = $1 AND user_id = $2', [trip.id, req.user.id]);
      await query('INSERT INTO trip_route_points (trip_id, user_id, lat, lng) VALUES ($1, $2, $3, $4)', [trip.id, req.user.id, lat, lng]);

      if (trip.status === 'upcoming') await query(`UPDATE trips SET status='active' WHERE id=$1`, [trip.id]);

      io.to(`trip:${trip.id}`).emit('trip:location:update', { trip_id: trip.id, user_id: req.user.id, lat, lng, updated_at: new Date().toISOString() });
      res.json({ message: 'Location updated' });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/locations', authRequired, async (req, res, next) => {
    try {
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      if (!(await isMember(trip.id, req.user.id))) return res.status(403).json({ error: 'Not a member of this trip' });

      const r = await query(
        `SELECT u.id, u.username, u.name, u.profile_pic_path, tl.lat, tl.lng, tl.updated_at
         FROM trip_locations tl JOIN users u ON u.id = tl.user_id WHERE tl.trip_id = $1`,
        [trip.id]
      );

      // Real "start point" for the map: the earliest location any member actually recorded
      // for this trip. trip_route_points is already populated by both the REST location
      // endpoint and the trip:location:update socket handler, so this is genuine tracked
      // data -- not a geocoded guess -- since start_point/destination on the trip itself
      // are free-text place names with no coordinates in this schema.
      const startRes = await query(
        `SELECT lat, lng, recorded_at FROM trip_route_points WHERE trip_id = $1 ORDER BY id ASC LIMIT 1`,
        [trip.id]
      );

      res.json({ locations: r.rows, route_start: startRes.rows[0] || null });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/chat', authRequired, async (req, res, next) => {
    try {
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      if (!(await isMember(trip.id, req.user.id))) return res.status(403).json({ error: 'Not a member of this trip' });

      const r = await query(
        `SELECT tm.*, u.username, u.name FROM trip_messages tm JOIN users u ON u.id = tm.sender_id
         WHERE tm.trip_id = $1 ORDER BY tm.created_at ASC`,
        [trip.id]
      );
      res.json({ messages: r.rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/chat', authRequired, async (req, res, next) => {
    try {
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      if (!(await isMember(trip.id, req.user.id))) return res.status(403).json({ error: 'Not a member of this trip' });

      const { content } = req.body || {};
      if (!content || !content.trim()) return res.status(400).json({ error: 'content is required' });
      if (content.length > 4000) return res.status(400).json({ error: 'Message too long' });

      const ins = await query('INSERT INTO trip_messages (trip_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *', [trip.id, req.user.id, content.trim()]);
      const message = ins.rows[0];

      io.to(`trip:${trip.id}`).emit('trip:chat:message', { ...message, username: req.user.username, name: req.user.name });
      res.status(201).json({ message });
    } catch (err) {
      next(err);
    }
  });

  // Shared by the two rider-status actions below: post a system-style trip chat message
  // (attributed to the acting rider) and notify every other member via the existing
  // notification pipeline (createNotification + the 'notification:new' socket event the
  // frontend already listens for) -- no new delivery mechanism, reuses what's working.
  async function postTripSystemMessage(trip, actingUser, content, notifType) {
    const ins = await query('INSERT INTO trip_messages (trip_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *', [trip.id, actingUser.id, content]);
    const message = ins.rows[0];
    io.to(`trip:${trip.id}`).emit('trip:chat:message', { ...message, username: actingUser.username, name: actingUser.name });

    const membersRes = await query('SELECT user_id FROM trip_members WHERE trip_id = $1 AND user_id != $2', [trip.id, actingUser.id]);
    for (const { user_id } of membersRes.rows) {
      const notif = await createNotification(trip.org_id, user_id, notifType, content, trip.id);
      io.to(`user:${user_id}`).emit('notification:new', notif);
    }
    return message;
  }

  // Any member can mark themselves as having reached the destination -- independent of
  // the leader's trip-wide "completed" status below.
  router.post('/:id/reached', authRequired, async (req, res, next) => {
    try {
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      if (!(await isMember(trip.id, req.user.id))) return res.status(403).json({ error: 'Not a member of this trip' });

      const r = await query(
        'UPDATE trip_members SET reached_at = now() WHERE trip_id = $1 AND user_id = $2 AND reached_at IS NULL RETURNING reached_at',
        [trip.id, req.user.id]
      );
      if (r.rows.length === 0) {
        const already = await query('SELECT reached_at FROM trip_members WHERE trip_id = $1 AND user_id = $2', [trip.id, req.user.id]);
        return res.json({ reached_at: already.rows[0] ? already.rows[0].reached_at : null });
      }

      io.to(`trip:${trip.id}`).emit('trip:member:reached', { trip_id: trip.id, user_id: req.user.id, reached_at: r.rows[0].reached_at });
      await postTripSystemMessage(trip, req.user, `${req.user.name} has reached the destination.`, 'trip_reached');
      res.json({ reached_at: r.rows[0].reached_at });
    } catch (err) {
      next(err);
    }
  });

  // Any member can send a "need to stop" alert to the rest of the group mid-ride.
  router.post('/:id/need-stop', authRequired, async (req, res, next) => {
    try {
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      if (!(await isMember(trip.id, req.user.id))) return res.status(403).json({ error: 'Not a member of this trip' });

      io.to(`trip:${trip.id}`).emit('trip:need-stop', { trip_id: trip.id, user_id: req.user.id, name: req.user.name, at: new Date().toISOString() });
      await postTripSystemMessage(trip, req.user, `${req.user.name} needs to stop the ride.`, 'trip_need_stop');
      res.status(201).json({ message: 'Alert sent to the group.' });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/complete', authRequired, async (req, res, next) => {
    try {
      const trip = await getTripInOrg(req.params.id, req.user.org_id);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      if (!isLeader(trip, req.user.id)) return res.status(403).json({ error: 'Only the trip leader can complete the trip' });

      const pointsRes = await query('SELECT lat, lng, recorded_at FROM trip_route_points WHERE trip_id = $1 ORDER BY id ASC', [trip.id]);
      const points = pointsRes.rows;

      let distance_km = 0;
      for (let i = 1; i < points.length; i++) {
        distance_km += haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
      }
      let duration_minutes = 0;
      if (points.length >= 2) {
        duration_minutes = Math.max(0, (new Date(points[points.length - 1].recorded_at) - new Date(points[0].recorded_at)) / 60000);
      }

      await query(
        `INSERT INTO trip_history (trip_id, distance_km, duration_minutes, completed_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (trip_id) DO UPDATE SET distance_km = excluded.distance_km, duration_minutes = excluded.duration_minutes, completed_at = excluded.completed_at`,
        [trip.id, Math.round(distance_km * 100) / 100, Math.round(duration_minutes)]
      );
      await query(`UPDATE trips SET status='completed' WHERE id=$1`, [trip.id]);
      io.to(`trip:${trip.id}`).emit('trip:completed', { trip_id: trip.id });

      res.json({ message: 'Trip marked completed', distance_km: Math.round(distance_km * 100) / 100, duration_minutes: Math.round(duration_minutes) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/history/all', authRequired, async (req, res, next) => {
    try {
      const r = await query(
        `SELECT t.*, th.distance_km, th.duration_minutes, th.completed_at
         FROM trips t JOIN trip_members tm ON tm.trip_id = t.id
         LEFT JOIN trip_history th ON th.trip_id = t.id
         WHERE tm.user_id = $1 AND t.org_id = $2 AND t.status = 'completed'
         ORDER BY th.completed_at DESC`,
        [req.user.id, req.user.org_id]
      );
      res.json({ history: r.rows });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
