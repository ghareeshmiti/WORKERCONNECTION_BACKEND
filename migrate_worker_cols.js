
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrateWorkers() {
    try {
        console.log('Adding columns to workers table...');

        // Add eshram_id
        await pool.query(`ALTER TABLE workers ADD COLUMN IF NOT EXISTS eshram_id TEXT`);

        // Add bocw_id
        await pool.query(`ALTER TABLE workers ADD COLUMN IF NOT EXISTS bocw_id TEXT`);

        // Add status (default active for existing)
        await pool.query(`ALTER TABLE workers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);

        console.log('Columns added successfully.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await pool.end();
    }
}

migrateWorkers();
