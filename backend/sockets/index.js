const { verifyAccessToken } = require('../utils/tokens');
const { query } = require('../db/pool');
const logger = require('../utils/logger');

function initSockets(io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = verifyAccessToken(token);
      const r = await query(
        `SELECT u.id, u.org_id, u.username, u.name, u.role, u.status as user_status, o.status as org_status
         FROM users u LEFT JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`,
        [payload.sub]
      );
      const row = r.rows[0];
      if (!row || row.user_status === 'disabled') return next(new Error('Account unavailable'));
      if (row.role !== 'super_admin' && row.org_status === 'disabled') return next(new Error('Organization disabled'));
      socket.user = { id: row.id, org_id: row.org_id, username: row.username, name: row.name, role: row.role };
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    socket.join(`user:${user.id}`);
    if (user.org_id) socket.join(`org:${user.org_id}`); // org-wide broadcast room (org admins use this for live-fleet views)

    const trips = await query('SELECT trip_id FROM trip_members WHERE user_id = $1', [user.id]);
    trips.rows.forEach((t) => socket.join(`trip:${t.trip_id}`));

    // Friend ids, resolved fresh per connection so a stale friend list can't leak location
    // to someone no longer actually a friend.
    const friendsRes = await query(
      `SELECT CASE WHEN user_id_1 = $1 THEN user_id_2 ELSE user_id_1 END as fid FROM friendships WHERE user_id_1 = $1 OR user_id_2 = $1`,
      [user.id]
    );
    const friendIds = friendsRes.rows.map((f) => f.fid);
    friendIds.forEach((fid) => io.to(`user:${fid}`).emit('presence:online', { user_id: user.id }));

    socket.on('location:update', async (data) => {
      try {
        const { lat, lng } = data || {};
        if (typeof lat !== 'number' || typeof lng !== 'number') return;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

        await query(
          `INSERT INTO locations (user_id, org_id, lat, lng, is_live, updated_at) VALUES ($1, $2, $3, $4, true, now())
           ON CONFLICT (user_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, is_live=true, updated_at=now()`,
          [user.id, user.org_id, lat, lng]
        );

        const payload = { user_id: user.id, username: user.username, name: user.name, lat, lng, updated_at: new Date().toISOString() };
        friendIds.forEach((fid) => io.to(`user:${fid}`).emit('location:friend:update', payload));
        if (user.org_id) io.to(`org:${user.org_id}`).emit('location:nearby:update', payload);
      } catch (err) {
        logger.error({ err }, 'location:update handler failed');
      }
    });

    socket.on('location:stop', async () => {
      try {
        await query(`UPDATE locations SET is_live = false, updated_at = now() WHERE user_id = $1`, [user.id]);
        friendIds.forEach((fid) => io.to(`user:${fid}`).emit('location:friend:offline', { user_id: user.id }));
      } catch (err) {
        logger.error({ err }, 'location:stop handler failed');
      }
    });

    socket.on('trip:join', async (tripId) => {
      try {
        const member = await query('SELECT 1 FROM trip_members WHERE trip_id=$1 AND user_id=$2', [tripId, user.id]);
        if (member.rows.length > 0) socket.join(`trip:${tripId}`);
      } catch (err) {
        logger.error({ err }, 'trip:join handler failed');
      }
    });

    socket.on('trip:location:update', async ({ trip_id, lat, lng }) => {
      try {
        if (!trip_id || typeof lat !== 'number' || typeof lng !== 'number') return;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

        // Verify trip belongs to this user's org AND they're a member -- prevents a socket
        // client from spoofing location updates into a trip it doesn't belong to.
        const tripRes = await query('SELECT org_id FROM trips WHERE id = $1', [trip_id]);
        if (!tripRes.rows[0] || tripRes.rows[0].org_id !== user.org_id) return;
        const member = await query('SELECT 1 FROM trip_members WHERE trip_id=$1 AND user_id=$2', [trip_id, user.id]);
        if (member.rows.length === 0) return;

        await query(
          `INSERT INTO trip_locations (trip_id, user_id, lat, lng, updated_at) VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (trip_id, user_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, updated_at=now()`,
          [trip_id, user.id, lat, lng]
        );
        await query('INSERT INTO trip_route_points (trip_id, user_id, lat, lng) VALUES ($1, $2, $3, $4)', [trip_id, user.id, lat, lng]);

        io.to(`trip:${trip_id}`).emit('trip:location:update', { trip_id, user_id: user.id, name: user.name, lat, lng, updated_at: new Date().toISOString() });
      } catch (err) {
        logger.error({ err }, 'trip:location:update handler failed');
      }
    });

    socket.on('chat:typing', ({ to_user_id }) => {
      if (to_user_id) io.to(`user:${to_user_id}`).emit('chat:typing', { from_user_id: user.id });
    });

    socket.on('trip:chat:typing', ({ trip_id }) => {
      if (trip_id) socket.to(`trip:${trip_id}`).emit('trip:chat:typing', { trip_id, from_user_id: user.id, name: user.name });
    });

    socket.on('disconnect', () => {
      friendIds.forEach((fid) => io.to(`user:${fid}`).emit('presence:offline', { user_id: user.id }));
    });
  });
}

module.exports = initSockets;
