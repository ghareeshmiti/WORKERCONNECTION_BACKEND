
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkWorkersRLS() {
    try {
        console.log('Checking RLS policies for workers table...');
        const res = await pool.query(`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
      FROM pg_policies 
      WHERE tablename = 'workers';
    `);

        if (res.rows.length === 0) {
            console.log('No policies found for workers table.');
        } else {
            console.table(res.rows);
        }

        console.log('Checking if RLS is enabled on workers table...');
        const res2 = await pool.query(`
        SELECT relname, relrowsecurity 
        FROM pg_class 
        WHERE oid = 'workers'::regclass;
    `);
        console.table(res2.rows);

    } catch (err) {
        console.error('Check failed:', err);
    } finally {
        await pool.end();
    }
}

checkWorkersRLS();
