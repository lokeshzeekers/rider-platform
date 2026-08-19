-- Adds optional real coordinates for a trip's destination, so the live map can show an
-- actual destination marker. Nullable and set independently of start_point/destination
-- (which remain free-text place names) -- never derived/geocoded from that text.
ALTER TABLE trips ADD COLUMN dest_lat DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN dest_lng DOUBLE PRECISION;
ALTER TABLE trips ADD CONSTRAINT chk_trips_dest_coords_paired
  CHECK ((dest_lat IS NULL) = (dest_lng IS NULL));
