const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function run() {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM workers LIMIT 1');
        console.log('Columns:', Object.keys(res.rows[0] || {}));
    } catch (e) { console.error(e); }
    finally { client.release(); }
}
run();
