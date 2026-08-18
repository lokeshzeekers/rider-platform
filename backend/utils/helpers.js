const { query } = require('../db/pool');

function orderedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function areFriends(userA, userB) {
  const [u1, u2] = orderedPair(userA, userB);
  const res = await query('SELECT id FROM friendships WHERE user_id_1 = $1 AND user_id_2 = $2', [u1, u2]);
  return res.rows.length > 0;
}

async function addFriendship(orgId, userA, userB) {
  const [u1, u2] = orderedPair(userA, userB);
  await query(
    'INSERT INTO friendships (org_id, user_id_1, user_id_2) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [orgId, u1, u2]
  );
}

// Public-safe user view. Phone is only included for self, admins, or accepted friends.
// This is the single choke point for the phone-privacy rule -- every route must go through
// this rather than hand-selecting columns, so the rule can't accidentally be bypassed.
async function serializeUser(targetUser, viewer) {
  if (!targetUser) return null;
  const isSelf = targetUser.id === viewer.id;
  const isPrivileged = viewer.role === 'super_admin' || (viewer.role === 'org_admin' && viewer.org_id === targetUser.org_id);
  const friend = isSelf || isPrivileged ? true : await areFriends(targetUser.id, viewer.id);

  return {
    id: targetUser.id,
    org_id: targetUser.org_id,
    username: targetUser.username,
    name: targetUser.name,
    bio: targetUser.bio,
    profile_pic_url: targetUser.profile_pic_path ? `/api/uploads/profile-pics/${targetUser.id}` : null,
    phone: friend ? targetUser.phone : null,
    email: isSelf || isPrivileged ? targetUser.email : undefined,
    role: isSelf || isPrivileged ? targetUser.role : undefined,
    status: isSelf || isPrivileged ? targetUser.status : undefined,
    is_friend: isSelf ? undefined : friend,
    created_at: targetUser.created_at
  };
}

async function createNotification(orgId, userId, type, content, relatedId = null) {
  const res = await query(
    `INSERT INTO notifications (org_id, user_id, type, content, related_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [orgId, userId, type, content, relatedId]
  );
  return res.rows[0];
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = { areFriends, addFriendship, serializeUser, createNotification, haversineKm };
