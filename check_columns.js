
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkColumns() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'establishments'");
        res.rows.forEach(r => console.log(r.column_name));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkColumns();
