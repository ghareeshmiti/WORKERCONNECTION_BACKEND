import pg from 'pg';
import 'dotenv/config';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function fix() {
    try {
        // Update worker WKR3169542398 with a sample photo
        const newPhoto = "https://randomuser.me/api/portraits/men/75.jpg";
        await pool.query("UPDATE workers SET photo_url=$1 WHERE worker_id='WKR3169542398'", [newPhoto]);
        console.log('Updated photo_url for WKR3169542398');
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
fix();
