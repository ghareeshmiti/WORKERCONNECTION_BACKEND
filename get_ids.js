
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function getIds() {
    try {
        const d = await pool.query('SELECT id, name FROM departments');
        console.log('DEPT IDs:', JSON.stringify(d.rows));

        const e = await pool.query('SELECT id, name, department_id FROM establishments');
        console.log('EST IDs:', JSON.stringify(e.rows));

        const w = await pool.query('SELECT id, first_name FROM workers');
        console.log('WORKER IDs:', JSON.stringify(w.rows));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

getIds();
