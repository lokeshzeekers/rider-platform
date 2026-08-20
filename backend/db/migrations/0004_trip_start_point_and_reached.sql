-- Symmetric to dest_lat/dest_lng: an explicit, optional, leader-pinned start coordinate
-- (never inferred/guessed) so the map's start marker can be as accurate as the
-- destination marker instead of only relying on the first live GPS fix recorded.
ALTER TABLE trips ADD COLUMN start_lat DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN start_lng DOUBLE PRECISION;
ALTER TABLE trips ADD CONSTRAINT chk_trips_start_coords_paired
  CHECK ((start_lat IS NULL) = (start_lng IS NULL));

-- Per-rider "I've arrived" marker, distinct from the leader's trip-wide "completed"
-- status -- lets each rider mark themselves as reached independently.
ALTER TABLE trip_members ADD COLUMN reached_at TIMESTAMPTZ;
