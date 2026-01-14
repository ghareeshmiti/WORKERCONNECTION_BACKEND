
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectData() {
    try {
        console.log('--- DEPARTMENTS ---');
        const depts = await pool.query('SELECT id, name, email FROM departments');
        console.table(depts.rows);

        console.log('\n--- ESTABLISHMENTS ---');
        // Show all establishments and who they belong to
        const ests = await pool.query('SELECT id, name, department_id, email FROM establishments');
        console.table(ests.rows);

        console.log('\n--- WORKERS ---');
        const workers = await pool.query('SELECT id, worker_id, first_name FROM workers');
        console.table(workers.rows);

        console.log('\n--- WORKER MAPPINGS ---');
        const mappings = await pool.query('SELECT * FROM worker_mappings');
        console.table(mappings.rows);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

inspectData();
