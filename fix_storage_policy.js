
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
    console.error('Missing env var: DATABASE_URL');
    process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function fixStoragePolicy() {
    console.log('Fixing storage policies for worker_photos via SQL...');

    const client = await pool.connect();
    try {
        // 1. Ensure bucket exists and is public via SQL
        console.log('Ensuring bucket exists and is public...');
        await client.query(`
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('worker_photos', 'worker_photos', true)
      ON CONFLICT (id) DO UPDATE SET public = true;
    `);

        // 2. Apply RLS Policies
        console.log('Updating RLS policies...');
        const sql = `
      -- Enable RLS on objects (idempotent usually)
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

      -- Drop existing policies to start fresh
      DROP POLICY IF EXISTS "Public Access" ON storage.objects;
      DROP POLICY IF EXISTS "Worker Photos Public Upload" ON storage.objects;
      DROP POLICY IF EXISTS "Worker Photos Public Select" ON storage.objects;
      DROP POLICY IF EXISTS "Worker Photos Public Update" ON storage.objects;
      
      -- Public SELECT (View)
      CREATE POLICY "Worker Photos Public Select"
      ON storage.objects FOR SELECT
      USING ( bucket_id = 'worker_photos' );

      -- Public INSERT (Upload)
      CREATE POLICY "Worker Photos Public Upload"
      ON storage.objects FOR INSERT
      WITH CHECK ( bucket_id = 'worker_photos' );

      -- Public UPDATE (Optional, but useful for retries/overwrites)
      CREATE POLICY "Worker Photos Public Update"
      ON storage.objects FOR UPDATE
      USING ( bucket_id = 'worker_photos' );
    `;

        await client.query(sql);
        console.log('Policies applied successfully.');

    } catch (err) {
        console.error('Error fixing storage policies:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

fixStoragePolicy();
