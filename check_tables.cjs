const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function run() {
    const client = await pool.connect();
    try {
        const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
        console.log('Tables:', res.rows.map(r => r.table_name));

        // Check columns of districts if it exists
        if (res.rows.find(r => r.table_name === 'districts')) {
            const dCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'districts'");
            console.log('District cols:', dCols.rows.map(c => c.column_name));
        }
    } catch (e) { console.error(e); }
    finally { client.release(); }
}
run();
