
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectAuth() {
    try {
        console.log('Inspecting auth.users...');
        const res = await pool.query('SELECT * FROM auth.users');
        console.log(res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

inspectAuth();
