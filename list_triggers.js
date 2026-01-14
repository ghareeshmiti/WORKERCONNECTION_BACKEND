
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function listTriggers() {
    try {
        console.log('Listing Triggers on auth.users (pg_trigger)...');
        const res = await pool.query(`
            SELECT tgname, tgtype, tgenabled, tgisinternal
            FROM pg_trigger
            WHERE tgrelid = 'auth.users'::regclass
        `);
        console.table(res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

listTriggers();
