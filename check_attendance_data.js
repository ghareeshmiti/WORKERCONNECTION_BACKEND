
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkAttendance() {
    const workerId = 'WKR00000001';
    try {
        console.log(`Checking events for ${workerId}...`);
        const resEvents = await pool.query('SELECT * FROM attendance_events WHERE worker_id = (SELECT id FROM workers WHERE worker_id = $1) ORDER BY occurred_at DESC', [workerId]);
        console.log(JSON.stringify(resEvents.rows, null, 2));

        console.log(`\nChecking daily rollups for ${workerId}...`);
        const resRollups = await pool.query('SELECT * FROM attendance_daily_rollups WHERE worker_id = (SELECT id FROM workers WHERE worker_id = $1)', [workerId]);
        console.log(JSON.stringify(resRollups.rows, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkAttendance();
