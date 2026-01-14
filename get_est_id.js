
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function getEstId() {
    try {
        const res = await pool.query('SELECT id FROM establishments LIMIT 1');
        console.log('EST_ID_CLEAN:' + res.rows[0].id);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

getEstId();
