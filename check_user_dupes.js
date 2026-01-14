
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkUserDupes() {
    try {
        console.log(`Checking for duplicate usernames in users table...`);
        const res = await pool.query('SELECT username, COUNT(*) as count FROM users GROUP BY username HAVING COUNT(*) > 1');
        if (res.rows.length === 0) {
            console.log("No duplicate usernames found.");
        } else {
            console.log("Duplicate usernames found:");
            console.table(res.rows);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkUserDupes();
