
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkEnum() {
    try {
        console.log('Checking enum values for app_role...');
        const res = await pool.query(`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'app_role';
    `);

        console.log('Valid app_role values:', res.rows.map(r => r.enumlabel));
    } catch (err) {
        console.error('Check failed:', err);
    } finally {
        await pool.end();
    }
}

checkEnum();
