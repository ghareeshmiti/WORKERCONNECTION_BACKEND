
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY); // Using service_role key would be better for admin tasks, but usually anon key + policies work if set up right. 
// Actually for bucket creation we might need service role key if RLS is strict, but let's try with what we have or use the dashboard URL/Service Key if available.
// Checking .env content again... we only have ANON_KEY in the file I saw earlier.
// Wait, I can try to use the postgres connection to insert into storage.buckets if the API fails, but the API is cleaner.
// Let's assume anon + adequate policy or just try. If fails, I might need to output instructions or try SQL.

// Actually, createBucket usually requires service role.
// Let's try to do it via SQL migration script instead, it's more reliable given we have the postgres connection string.

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function setupStorage() {
    try {
        console.log('Setting up storage bucket...');

        // Create bucket if not exists
        await pool.query(`
            INSERT INTO storage.buckets (id, name, public)
            VALUES ('worker_photos', 'worker_photos', true)
            ON CONFLICT (id) DO NOTHING;
        `);
        console.log('Bucket worker_photos created/verified.');

        // Allow Public Read
        await pool.query(`
            CREATE POLICY "Public Access"
            ON storage.objects FOR SELECT
            USING ( bucket_id = 'worker_photos' );
        `).catch(err => {
            // Ignore if policy already exists (postgres doesn't have IF NOT EXISTS for policies easily without a function or DO block)
            if (!err.message.includes('already exists')) console.error('Policy Public Access error:', err.message);
        });

        // Allow Authenticated Uploads
        await pool.query(`
            CREATE POLICY "Authenticated Uploads"
            ON storage.objects FOR INSERT
            TO authenticated
            WITH CHECK ( bucket_id = 'worker_photos' );
        `).catch(err => {
            if (!err.message.includes('already exists')) console.error('Policy Authenticated Uploads error:', err.message);
        });

        // Allow Global Update (for simplicity in this iteration, restrict in prod)
        await pool.query(`
            CREATE POLICY "Global Update"
            ON storage.objects FOR UPDATE
            TO authenticated
            USING ( bucket_id = 'worker_photos' );
        `).catch(err => {
            if (!err.message.includes('already exists')) console.error('Policy Global Update error:', err.message);
        });

        console.log('Storage policies configured.');

    } catch (e) {
        console.error('Storage setup failed:', e);
    } finally {
        await pool.end();
    }
}

setupStorage();
