-- Migration: venue_maps_storage
-- Creates the venue-maps storage bucket (public) and allows anyone to read
-- floor plan images. Uploads are restricted to the service role key only
-- (service role bypasses RLS by default — no INSERT policy needed).

INSERT INTO storage.buckets (id, name, public)
VALUES ('venue-maps', 'venue-maps', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow public (unauthenticated) read of all objects in the venue-maps bucket.
-- This lets the frontend load floor plan images directly from their public URL.
DROP POLICY IF EXISTS "venue-maps public read" ON storage.objects;
CREATE POLICY "venue-maps public read" ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'venue-maps');
