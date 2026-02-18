
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkRLS() {
    try {
        console.log('Checking RLS policies for tickets table...');
        const res = await pool.query(`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
      FROM pg_policies 
      WHERE tablename = 'tickets';
    `);

        if (res.rows.length === 0) {
            console.log('No policies found for tickets table.');
        } else {
            console.table(res.rows);
        }

        console.log('Checking if RLS is enabled on tickets table...');
        const res2 = await pool.query(`
        SELECT relname, relrowsecurity 
        FROM pg_class 
        WHERE oid = 'tickets'::regclass;
    `);
        console.table(res2.rows);

    } catch (err) {
        console.error('Check failed:', err);
    } finally {
        await pool.end();
    }
}

checkRLS();
