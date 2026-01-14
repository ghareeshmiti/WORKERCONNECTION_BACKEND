
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkGlobalDupes() {
    try {
        console.log(`Checking for users with multiple authenticators...`);
        const res = await pool.query('SELECT username, COUNT(*) as count FROM authenticators GROUP BY username HAVING COUNT(*) > 1');
        if (res.rows.length === 0) {
            console.log("No users found with duplicate authenticators.");
        } else {
            console.log("Users with multiple authenticators:");
            console.table(res.rows);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkGlobalDupes();
