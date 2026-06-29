-- Migration: session_tracking_gaps
-- Adds was_operator_reset, was_wrong_location, experience_start_duration_ms
-- to experience_sessions; stage_duration_ms to session_stage_events.

ALTER TABLE experience_sessions
  ADD COLUMN IF NOT EXISTS was_operator_reset         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS experience_start_duration_ms INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS was_wrong_location         INTEGER NOT NULL DEFAULT 0;

ALTER TABLE session_stage_events
  ADD COLUMN IF NOT EXISTS stage_duration_ms INTEGER DEFAULT NULL;
