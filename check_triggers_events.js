
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkTriggers() {
    try {
        const res = await pool.query(`
            SELECT event_object_table, trigger_name, action_statement
            FROM information_schema.triggers
            WHERE event_object_table = 'attendance_events'
        `);
        console.log('Triggers:', res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkTriggers();
