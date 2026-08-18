const { query } = require('../db/pool');

/**
 * Records an administrative action. Called from super-admin and org-admin routes whenever
 * they create/modify/disable something. Never throws into the caller's response path —
 * a logging failure shouldn't break the action itself, but it is logged loudly.
 */
async function recordAudit({ actorUserId, actorRole, orgId = null, action, targetType, targetId, metadata = {}, ip }) {
  try {
    await query(
      `INSERT INTO audit_logs (actor_user_id, actor_role, org_id, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [actorUserId, actorRole, orgId, action, targetType, String(targetId ?? ''), JSON.stringify(metadata), ip || null]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('AUDIT LOG WRITE FAILED', action, err.message);
  }
}

module.exports = { recordAudit };
