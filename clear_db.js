
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function clearData() {
    try {
        console.log('Clearing data...');
        // Order matters due to FKs
        await pool.query('DELETE FROM audit_logs');
        await pool.query('DELETE FROM checks'); // Legacy table
        await pool.query('DELETE FROM attendance_events');
        await pool.query('DELETE FROM attendance_daily_rollups');
        await pool.query('DELETE FROM worker_mappings');
        await pool.query('DELETE FROM workers');
        await pool.query('DELETE FROM authenticators');
        await pool.query('DELETE FROM users'); // FIDO users

        console.log('All worker and FIDO data cleared.');
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

clearData();
