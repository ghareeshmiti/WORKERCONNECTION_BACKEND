
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkPolicies() {
    try {
        const query = `
            SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
            FROM pg_policies 
            WHERE tablename IN ('establishments', 'worker_mappings');
        `;
        const res = await pool.query(query);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkPolicies();
