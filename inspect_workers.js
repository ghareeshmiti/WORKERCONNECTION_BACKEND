
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectWorkers() {
    const client = await pool.connect();
    try {
        console.log('Inspecting workers...');
        const result = await client.query('SELECT worker_id, first_name, status, is_active, district FROM workers');
        console.log(JSON.stringify(result.rows, null, 2));
    } catch (err) {
        console.error('Inspection failed:', err);
    } finally {
        client.release();
        pool.end();
    }
}

inspectWorkers();
