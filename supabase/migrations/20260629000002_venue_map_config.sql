-- Migration: venue_map_config
-- Creates the venue map calibration table used by the Spatial View floor-plan map.
-- Floor plan images are stored in Supabase Storage bucket: venue-maps

CREATE TABLE IF NOT EXISTS venue_map_config (
  premise_id    TEXT    PRIMARY KEY,
  image_path    TEXT    DEFAULT NULL,
  scale         FLOAT   NOT NULL DEFAULT 1,
  offset_x      FLOAT   NOT NULL DEFAULT 0,
  offset_y      FLOAT   NOT NULL DEFAULT 0,
  rotation_deg  FLOAT   NOT NULL DEFAULT 0,
  flip_x        BOOLEAN NOT NULL DEFAULT false,
  flip_y        BOOLEAN NOT NULL DEFAULT false,
  updated_at    BIGINT  DEFAULT NULL
);

-- Allow the frontend (anon key) to read map config; this table holds no
-- sensitive data and must be publicly readable for the Spatial View to work.
ALTER TABLE venue_map_config DISABLE ROW LEVEL SECURITY;
GRANT SELECT ON venue_map_config TO anon;
