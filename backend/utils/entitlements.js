/**
 * This module is the single seam where monetization enforcement will plug in later.
 * Every route that will eventually need a plan/feature check should call hasFeature()
 * or assertFeature() rather than hand-rolling its own check, so flipping
 * MONETIZATION_ENABLED to true in .env activates real enforcement everywhere at once,
 * without touching route code.
 *
 * Today (MONETIZATION_ENABLED=false): every feature check short-circuits to true.
 * Later: this will resolve org plan + user override (whichever is more permissive),
 * check expiry/trial status, and check the specific feature flag / usage limit.
 */
const { query } = require('../db/pool');

const MONETIZATION_ENABLED = process.env.MONETIZATION_ENABLED === 'true';

async function resolveEffectivePlan(userId, orgId) {
  // Not used while monetization is disabled, but implemented now so the future
  // "org plan + user override, whichever is more permissive" logic has a home.
  const overrideRes = await query(
    `SELECT p.* FROM user_entitlement_overrides ueo
     JOIN plans p ON p.id = ueo.plan_id
     WHERE ueo.user_id = $1 AND (ueo.expires_at IS NULL OR ueo.expires_at > now())
     ORDER BY ueo.created_at DESC LIMIT 1`,
    [userId]
  );
  if (overrideRes.rows.length > 0) return overrideRes.rows[0];

  const subRes = await query(
    `SELECT p.* FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.org_id = $1 AND s.status IN ('active', 'trial', 'manual')
       AND (s.expires_at IS NULL OR s.expires_at > now())
     ORDER BY s.created_at DESC LIMIT 1`,
    [orgId]
  );
  return subRes.rows[0] || null;
}

async function hasFeature(userId, orgId, featureKey) {
  if (!MONETIZATION_ENABLED) return true;
  const plan = await resolveEffectivePlan(userId, orgId);
  if (!plan) return false;
  return !!plan.features?.[featureKey];
}

// Express middleware form
function requireFeature(featureKey) {
  return async (req, res, next) => {
    if (!MONETIZATION_ENABLED) return next();
    try {
      const ok = await hasFeature(req.user.id, req.user.org_id, featureKey);
      if (!ok) return res.status(402).json({ error: `Your plan does not include "${featureKey}"` });
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { MONETIZATION_ENABLED, hasFeature, requireFeature, resolveEffectivePlan };
