-- Analytics Events Table + Calibration Events View
--
-- Run this in the Supabase SQL Editor (Database → SQL Editor → New query).
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE / idempotent guards.
--
-- Purpose: receives discrete in-experience events fired by Unity headsets via
-- POST /api/analytics_event. The backend stores them locally in SQLite and syncs
-- unsynced rows here on the regular analytics sync interval.
--
-- Current events:
--   calibration_confirm_done  {
--     "from": "points" | "single_press" | "skip_verify",
--     "number_of_scan_meshes": int   -- AR scan mesh count at confirmation; proxy for spatial mapping quality
--   }

-- ============================================================
-- 1. Base table
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics_events (
    event_id    TEXT        PRIMARY KEY,
    device_id   TEXT        NOT NULL,
    app_version TEXT,
    event_name  TEXT        NOT NULL,
    -- JSON-encoded event-specific payload (matches Unity AnalyticsEvent.parameters field)
    parameters  TEXT,
    -- Unix millisecond timestamp when the operator server received the event
    received_at BIGINT      NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Service role (used by the backend sync) can insert rows
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'analytics_events' AND policyname = 'insert_analytics_events'
    ) THEN
        CREATE POLICY "insert_analytics_events"
            ON analytics_events FOR INSERT
            WITH CHECK (true);
    END IF;
END $$;

-- Read access for analytics queries (anon key / Supabase Studio / analytics app)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'analytics_events' AND policyname = 'read_analytics_events'
    ) THEN
        CREATE POLICY "read_analytics_events"
            ON analytics_events FOR SELECT
            USING (true);
    END IF;
END $$;

-- ============================================================
-- 2. Calibration events view
--    Unpacks the parameters JSON so the analytics app can query
--    calibration_method and scan_meshes as proper columns.
-- ============================================================

CREATE OR REPLACE VIEW calibration_events AS
SELECT
    event_id,
    device_id,
    app_version,
    received_at,
    -- Human-readable UTC timestamp
    to_timestamp(received_at / 1000.0) AT TIME ZONE 'UTC'  AS received_at_utc,
    -- Calibration gesture: "points" | "single_press" | "skip_verify"
    parameters::json->>'from'                               AS calibration_method,
    -- AR scan mesh count at moment of confirmation (higher = better spatial mapping)
    (parameters::json->>'number_of_scan_meshes')::int       AS scan_meshes,
    created_at
FROM analytics_events
WHERE event_name = 'calibration_confirm_done';
