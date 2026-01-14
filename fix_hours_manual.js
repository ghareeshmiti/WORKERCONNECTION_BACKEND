
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixHours() {
    const workerId = 'WKR00000001';
    try {
        console.log(`Fixing hours for ${workerId}...`);

        // Get Worker UUID
        const resWorker = await pool.query('SELECT id FROM workers WHERE worker_id = $1', [workerId]);
        const uuid = resWorker.rows[0].id;

        // Run Update
        const res = await pool.query(`
            UPDATE attendance_daily_rollups 
            SET total_hours = ROUND(CAST(EXTRACT(EPOCH FROM (last_checkout_at - first_checkin_at)) / 3600 AS numeric), 2)
            WHERE worker_id = $1 AND last_checkout_at IS NOT NULL
            RETURNING total_hours
        `, [uuid]);

        console.log(`Updated ${res.rowCount} rows.`);
        res.rows.forEach(r => console.log(`New Value: ${r.total_hours}`));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

fixHours();
