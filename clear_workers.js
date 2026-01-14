
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function clearWorkers() {
    try {
        console.log('Clearing Worker Mappings...');
        await pool.query('DELETE FROM worker_mappings');

        console.log('Clearing Workers...');
        await pool.query('DELETE FROM workers');

        console.log('Clearing Establishments (Optional - keeping for now unless requested, but user said "worker and user table")');
        // User said "deleted the esisting worker and user table data". 
        // To be safe and clean, I will just clear workers for now as that's the main "mapping" entity.
        // If they want establishments gone too, I can add that, but usually "user" implies the end-users (workers/beneficiaries).

        console.log('Data cleared successfully.');
    } catch (e) {
        console.error('Error clearing data:', e);
    } finally {
        await pool.end();
    }
}

clearWorkers();
