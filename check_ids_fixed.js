
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkIdsFixed() {
    const workerId = 'WKR00000001';
    try {
        const resRollups = await pool.query('SELECT id, establishment_id, attendance_date, total_hours FROM attendance_daily_rollups WHERE worker_id = (SELECT id FROM workers WHERE worker_id = $1)', [workerId]);
        console.log("--- ROLLUPS ---");
        console.table(resRollups.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkIdsFixed();
