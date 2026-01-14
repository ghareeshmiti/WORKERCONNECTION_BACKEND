
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkHours() {
    const workerId = 'WKR00000001';
    try {
        console.log(`Checking timestamps for ${workerId}...`);

        // Get Worker UUID
        const resWorker = await pool.query('SELECT id FROM workers WHERE worker_id = $1', [workerId]);
        if (resWorker.rows.length === 0) { console.log("Worker not found"); return; }
        const uuid = resWorker.rows[0].id;

        const resRollup = await pool.query(`
            SELECT id, attendance_date, first_checkin_at, last_checkout_at, total_hours
            FROM attendance_daily_rollups 
            WHERE worker_id = $1 
            ORDER BY attendance_date DESC LIMIT 1
        `, [uuid]);

        if (resRollup.rows.length === 0) {
            console.log("No rollups found.");
        } else {
            const row = resRollup.rows[0];
            console.log("--- LATEST ROLLUP ---");
            console.log(JSON.stringify(row, null, 2));

            if (row.first_checkin_at && row.last_checkout_at) {
                const start = new Date(row.first_checkin_at);
                const end = new Date(row.last_checkout_at);
                const diffMs = end - start;
                const hours = diffMs / (1000 * 60 * 60);
                console.log(`\nManual Validations:`);
                console.log(`Start: ${start.toISOString()}`);
                console.log(`End:   ${end.toISOString()}`);
                console.log(`Diff (ms): ${diffMs}`);
                console.log(`Hours (raw): ${hours}`);
                console.log(`Hours (fixed 2): ${hours.toFixed(2)}`);
            } else {
                console.log("\nTimestamps incomplte.");
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkHours();
