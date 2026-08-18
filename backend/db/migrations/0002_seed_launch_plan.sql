-- Seeds a single "launch" plan with every feature unlocked and no limits, and a function that
-- auto-subscribes every new organization to it. This is the mechanism that gives everyone full
-- access today while leaving the subscription system fully wired for later.

INSERT INTO plans (code, name, description, features, limits, price_cents, billing_interval, is_active)
VALUES (
  'launch_unlimited',
  'Launch (Full Access)',
  'Default plan during the free launch period. All features enabled, no usage limits.',
  '{"live_tracking": true, "friends": true, "chat": true, "trips": true, "group_trip_tracking": true, "trip_chat": true, "trip_history": true, "notifications": true}',
  '{"max_users": null, "max_active_trips": null, "max_trip_members": null}',
  0,
  'lifetime',
  true
);

CREATE OR REPLACE FUNCTION auto_subscribe_new_org() RETURNS TRIGGER AS $$
DECLARE
  launch_plan_id UUID;
BEGIN
  SELECT id INTO launch_plan_id FROM plans WHERE code = 'launch_unlimited';
  IF launch_plan_id IS NOT NULL THEN
    INSERT INTO subscriptions (org_id, plan_id, status, started_at)
    VALUES (NEW.id, launch_plan_id, 'active', now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_subscribe_new_org
AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION auto_subscribe_new_org();
