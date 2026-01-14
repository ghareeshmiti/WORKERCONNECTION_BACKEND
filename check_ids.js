
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkIds() {
    const workerId = 'WKR00000001';
    try {
        const resRollups = await pool.query('SELECT id, worker_id, establishment_id, date, total_hours FROM attendance_daily_rollups WHERE worker_id = (SELECT id FROM workers WHERE worker_id = $1)', [workerId]);
        console.log("--- ROLLUPS ---");
        console.table(resRollups.rows);

        const resWorkerMap = await pool.query('SELECT * FROM worker_mappings WHERE worker_id = (SELECT id FROM workers WHERE worker_id = $1)', [workerId]);
        console.log("--- WORKER MAPPINGS ---");
        console.table(resWorkerMap.rows);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkIds();
