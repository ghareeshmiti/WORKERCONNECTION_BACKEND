
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function enablePublicReadWorkers() {
    try {
        console.log('Creating public read policy for workers table...');

        // Check if policy exists first to avoid error? Or just use IF NOT EXISTS if PG supports it for policies (PG 10+)
        // But easier to just drop and recreate or catch error.

        await pool.query(`
      DROP POLICY IF EXISTS "Public Read Workers" ON workers;
      CREATE POLICY "Public Read Workers" ON workers FOR SELECT USING (true);
    `);

        // Also ensure RLS is enabled (it is, but good practice)
        await pool.query(`ALTER TABLE workers ENABLE ROW LEVEL SECURITY;`);

        console.log('Public Read Policy created for workers.');

    } catch (err) {
        console.error('Failed to create policy:', err);
    } finally {
        await pool.end();
    }
}

enablePublicReadWorkers();
