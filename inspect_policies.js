
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkPolicies() {
    try {
        console.log('Checking Policies on public.workers...');
        const res = await pool.query(`
            SELECT policyname, cmd, roles, qual, with_check 
            FROM pg_policies 
            WHERE tablename = 'workers'
        `);
        console.table(res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

checkPolicies();
