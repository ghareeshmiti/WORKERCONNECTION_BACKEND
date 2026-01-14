
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkCols() {
    try {
        console.log('Checking columns for establishments...');
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'establishments'
        `);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkCols();
