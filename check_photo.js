import pg from 'pg';
import 'dotenv/config';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
    try {
        const res = await pool.query("SELECT photo_url FROM workers WHERE worker_id='WKR3169542398'");
        console.log('Photo URL:', res.rows[0]?.photo_url);
        if (!res.rows[0]) console.log('Worker not found');
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
check();
