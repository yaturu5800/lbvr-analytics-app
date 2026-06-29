-- ============================================================
-- Apply all migrations to production — paste this entire file
-- into Supabase dashboard → SQL Editor → Run
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE).
-- ============================================================

-- 20260629000001: session_tracking_gaps
ALTER TABLE experience_sessions
  ADD COLUMN IF NOT EXISTS was_operator_reset          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS experience_start_duration_ms INTEGER         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS was_wrong_location          INTEGER NOT NULL DEFAULT 0;

ALTER TABLE session_stage_events
  ADD COLUMN IF NOT EXISTS stage_duration_ms INTEGER DEFAULT NULL;

-- 20260629000002: venue_map_config
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

ALTER TABLE venue_map_config DISABLE ROW LEVEL SECURITY;
GRANT SELECT ON venue_map_config TO anon;

-- 20260629000003: analytics_views
CREATE OR REPLACE VIEW recalibration_events AS
  SELECT *
  FROM   session_stage_events
  WHERE  stage_from IN ('Calibration', 'calibrating')
  AND    stage_duration_ms > 5000;

CREATE OR REPLACE VIEW wrong_location_starts AS
  SELECT *
  FROM   experience_sessions
  WHERE  was_wrong_location = 1;

-- 20260629000004: venue_maps_storage
-- Creates the venue-maps bucket (public) and a read policy for the frontend.
-- Uploads use the service role key which bypasses RLS — no INSERT policy needed.
INSERT INTO storage.buckets (id, name, public)
VALUES ('venue-maps', 'venue-maps', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "venue-maps public read" ON storage.objects;
CREATE POLICY "venue-maps public read" ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'venue-maps');
