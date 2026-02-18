
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkRTCUser() {
    const client = await pool.connect();
    try {
        console.log('Checking RTC User Data...');

        // 1. Get User ID from auth.users (optional, but good to know)
        // We can't query auth.users easily without permissions, but we can query departments by email

        const res = await client.query("SELECT * FROM departments WHERE code = 'RTC'");
        if (res.rows.length > 0) {
            console.log('Department Found (By Code RTC):', res.rows[0]);
            console.log('Department Email:', res.rows[0].email);
            console.log('Department ID:', res.rows[0].id);
        } else {
            console.log('Department NOT found with code RTC');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

checkRTCUser();
