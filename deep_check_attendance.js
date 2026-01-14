
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function deepCheck() {
    const workerId = 'WKR00000001';
    try {
        console.log(`Deep check for ${workerId}...`);

        // 1. Get Worker UUID
        const resWorker = await pool.query('SELECT id FROM workers WHERE worker_id = $1', [workerId]);
        if (resWorker.rows.length === 0) { console.log("Worker not found"); return; }
        const uuid = resWorker.rows[0].id;

        // 2. Get Events
        const resEvents = await pool.query(`
            SELECT id, event_type, establishment_id, region, occurred_at 
            FROM attendance_events 
            WHERE worker_id = $1 
            ORDER BY occurred_at DESC LIMIT 1
        `, [uuid]);

        console.log("\n--- LATEST EVENT ---");
        if (resEvents.rows.length === 0) console.log("No events found.");
        else console.log(JSON.stringify(resEvents.rows[0], null, 2));

        const evtEstId = resEvents.rows[0]?.establishment_id;

        // 3. Get Rollups
        const resRollup = await pool.query(`
            SELECT id, establishment_id, attendance_date, total_hours, status
            FROM attendance_daily_rollups 
            WHERE worker_id = $1 
            ORDER BY attendance_date DESC LIMIT 1
        `, [uuid]);

        console.log("\n--- LATEST ROLLUP ---");
        if (resRollup.rows.length === 0) console.log("No rollups found.");
        else console.log(JSON.stringify(resRollup.rows[0], null, 2));

        // 4. Check IDs against Establishments table
        if (evtEstId) {
            const resEst = await pool.query('SELECT id, name FROM establishments WHERE id = $1', [evtEstId]);
            console.log("\n--- LINKED ESTABLISHMENT ---");
            console.log(JSON.stringify(resEst.rows[0], null, 2));
        } else {
            console.log("\n!!! EVENT HAS NO ESTABLISHMENT ID !!!");
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

deepCheck();
