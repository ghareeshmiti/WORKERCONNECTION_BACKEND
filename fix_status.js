
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runMigration() {
    const client = await pool.connect();
    try {
        console.log('Running status backfill migration...');

        const result = await client.query(`
      UPDATE workers 
      SET status = 'new' 
      WHERE status IS NULL
    `);

        console.log(`Updated ${result.rowCount} workers from NULL to 'new'.`);

        // Also ensure is_active is true for these new ones if needed, but the previous code set it to true.

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        client.release();
        pool.end();
    }
}

runMigration();
