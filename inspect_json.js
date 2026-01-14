
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectData() {
    try {
        const counts = {};

        const depts = await pool.query('SELECT * FROM departments');
        counts.departments = depts.rows;

        const ests = await pool.query('SELECT * FROM establishments');
        counts.establishments = ests.rows;

        const workers = await pool.query('SELECT * FROM workers');
        counts.workers = workers.rows;

        const mappings = await pool.query('SELECT * FROM worker_mappings');
        counts.mappings = mappings.rows;

        console.log(JSON.stringify(counts, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

inspectData();
