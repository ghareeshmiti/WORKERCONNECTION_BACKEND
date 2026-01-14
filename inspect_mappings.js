
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkMappingPolicies() {
    try {
        console.log('Checking Policies on public.worker_mappings...');
        const res = await pool.query(`
            SELECT policyname, cmd, roles, qual, with_check 
            FROM pg_policies 
            WHERE tablename = 'worker_mappings'
        `);
        console.table(res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

checkMappingPolicies();
