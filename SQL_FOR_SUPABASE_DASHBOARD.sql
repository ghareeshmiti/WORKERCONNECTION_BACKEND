-- RUN THIS SCRIPT IN YOUR SUPABASE DASHBOARD > SQL EDITOR
-- This will fix the "Row Level Security" error for photo uploads.

-- 1. Enable RLS on objects (if not already acting)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Worker Photos Public Upload" ON storage.objects;
DROP POLICY IF EXISTS "Worker Photos Public Select" ON storage.objects;
DROP POLICY IF EXISTS "Worker Photos Public Update" ON storage.objects;
DROP POLICY IF EXISTS "Give public access to worker_photos" ON storage.objects;

-- 3. Create Policy: Allow Public SELECT (View Photos)
CREATE POLICY "Worker Photos Public Select"
ON storage.objects FOR SELECT
USING ( bucket_id = 'worker_photos' );

-- 4. Create Policy: Allow Public INSERT (Upload Photos)
-- This allows unauthenticated users (registration form) to upload photos
CREATE POLICY "Worker Photos Public Upload"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'worker_photos' );

-- 5. Create Policy: Allow Public UPDATE (Replace Photos)
CREATE POLICY "Worker Photos Public Update"
ON storage.objects FOR UPDATE
USING ( bucket_id = 'worker_photos' );

-- 6. Ensure the bucket exists and is public
INSERT INTO storage.buckets (id, name, public)
VALUES ('worker_photos', 'worker_photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;
