
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkDupes() {
    const username = 'WKR00000001';
    try {
        console.log(`Checking authenticators for ${username}...`);
        const res = await pool.query('SELECT username, "credentialID", counter, transports FROM authenticators WHERE username = $1', [username]);
        console.log(`Found ${res.rows.length} credentials:`);
        res.rows.forEach((row, i) => {
            console.log(`[${i + 1}] CredID Length: ${row.credentialID.length}, Counter: ${row.counter}`);
        });
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkDupes();
