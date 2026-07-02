export interface ExperienceSession {
  session_id: string
  device_id: string
  premise_id: string
  experience_id: string
  language: string
  started_at: number
  ended_at: number
  duration_seconds: number
  was_completed: boolean
  was_operator_ended: number
  was_skipped_to_main: number
  was_operator_reset: number
  was_wrong_location: number
  experience_start_duration_ms: number | null
  group_id: string | null
  last_stage_seen: string | null
  created_at: string
}

export interface DeviceHealthSnapshot {
  snapshot_id: string
  device_id: string
  captured_at: number
  online: number
  battery_level: number
  wifi_strength: number
  app_version: string
  device_state: string
  premise_id: string
  experience_id: string
  language: string
  created_at: string
}

export interface SessionStageEvent {
  event_id: string
  device_id: string
  premise_id: string
  experience_id: string
  session_id: string | null
  stage_from: string
  stage_to: string
  transitioned_at: number
  position_x: number | null
  position_y: number | null
  position_z: number | null
  rotation_x: number | null
  rotation_y: number | null
  rotation_z: number | null
  rotation_w: number | null
  was_operator_triggered: number
  stage_duration_ms: number | null
  created_at: string
}

export interface SessionOutcome {
  play_date: string
  natural: number
  operator_ended: number
  failure: number
  skipped_then_completed: number
  total: number
}

export interface FunnelSummary {
  experience_id: string
  premise_id: string
  entered_start: number
  entered_main: number
  reached_end: number
}

export type SessionOutcomeLabel = 'natural' | 'operator_ended' | 'operator_reset' | 'failure' | 'skipped_then_completed'

export interface VenueMapConfig {
  premise_id: string
  image_path: string | null
  scale: number
  offset_x: number
  offset_y: number
  rotation_deg: number
  flip_x: boolean
  flip_y: boolean
  updated_at: number | null
}

export interface Database {
  public: {
    Tables: {
      experience_sessions: { Row: ExperienceSession; Insert: ExperienceSession; Update: Partial<ExperienceSession> }
      device_health_snapshots: { Row: DeviceHealthSnapshot; Insert: DeviceHealthSnapshot; Update: Partial<DeviceHealthSnapshot> }
      session_stage_events: { Row: SessionStageEvent; Insert: SessionStageEvent; Update: Partial<SessionStageEvent> }
      venue_map_config: { Row: VenueMapConfig; Insert: VenueMapConfig; Update: Partial<VenueMapConfig> }
    }
    Views: {
      session_outcomes: { Row: SessionOutcome }
      funnel_summary: { Row: FunnelSummary }
      recalibration_events: { Row: SessionStageEvent }
      wrong_location_starts: { Row: ExperienceSession }
    }
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
