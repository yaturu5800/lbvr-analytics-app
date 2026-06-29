-- Migration: analytics_views
-- Convenience views for wrong-location and recalibration analytics.

CREATE OR REPLACE VIEW recalibration_events AS
  SELECT *
  FROM   session_stage_events
  WHERE  stage_from IN ('Calibration', 'calibrating')
  AND    stage_duration_ms > 5000;

CREATE OR REPLACE VIEW wrong_location_starts AS
  SELECT *
  FROM   experience_sessions
  WHERE  was_wrong_location = 1;
