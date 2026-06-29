# Supabase Migrations

All schema changes (new tables, columns, views, policies) live here as numbered SQL files.
Both dev and production must always be at the same migration level.

## Folder structure

```
supabase/
  migrations/
    20260629000001_session_tracking_gaps.sql
    20260629000002_venue_map_config.sql
    20260629000003_analytics_views.sql
    ...
```

## Applying migrations to production

1. Copy the SQL from each new migration file
2. Paste and run it in the **production** Supabase dashboard → SQL Editor

Or use the Supabase CLI if your production project is linked:

```bash
npx supabase db push --db-url "postgresql://postgres:<password>@<host>:5432/postgres"
```

## Adding a new migration

1. Create a new file: `supabase/migrations/YYYYMMDDNNNNNN_short_description.sql`
   - Timestamp format: `YYYYMMDD` + 6-digit sequence (e.g. `000001`)
   - Always use `IF NOT EXISTS` / `IF EXISTS` / `OR REPLACE` so migrations are safe to re-run
2. Write your SQL (ALTER TABLE, CREATE TABLE, CREATE VIEW, etc.)
3. Run it on dev first, verify the app works
4. Commit the file
5. Apply it to production using the method above

## Current migration history

| File | What it does |
|------|-------------|
| `20260629000001_session_tracking_gaps.sql` | Adds `was_operator_reset`, `experience_start_duration_ms`, `was_wrong_location` to `experience_sessions`; `stage_duration_ms` to `session_stage_events` |
| `20260629000002_venue_map_config.sql` | Creates `venue_map_config` table for floor-plan map calibration; disables RLS; grants anon SELECT |
| `20260629000003_analytics_views.sql` | Creates `recalibration_events` and `wrong_location_starts` views |
| `20260629000004_venue_maps_storage.sql` | Creates `venue-maps` storage bucket (public) + public read policy for floor plan images |
