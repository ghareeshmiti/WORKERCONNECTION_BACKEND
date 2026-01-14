
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const EST_ID = '6c6c4807-d596-43d6-90ac-22fbc75b338f';
const WORKER_ID = 'fa401871-d038-4014-9be3-d61fe8f63b28';

async function linkWorker() {
    try {
        console.log(`Linking Worker ${WORKER_ID} to Est ${EST_ID}...`);

        await pool.query(`
            INSERT INTO worker_mappings (establishment_id, worker_id, created_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT DO NOTHING
        `, [EST_ID, WORKER_ID]);

        console.log('Link created successfully.');

    } catch (e) {
        console.error('Error linking worker:', e);
    } finally {
        await pool.end();
    }
}

linkWorker();
