
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const EMAIL = "vijayawada.welfare@gmail.com";

async function cleanDept() {
    try {
        console.log(`Cleaning up ${EMAIL}...`);

        // Delete from public.departments
        await pool.query('DELETE FROM departments WHERE email = $1', [EMAIL]);

        // Also try to clean auth.users just in case there's a phantom record
        // (Though previous failure suggests it might not be there)
        await pool.query("DELETE FROM auth.users WHERE email = $1", [EMAIL]);

        console.log('Cleanup complete. You can now register manually.');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

cleanDept();
