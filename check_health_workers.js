import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const res = await pool.query(`SELECT * FROM workers WHERE worker_id IN ('WKR2445425056','WKR3169542398') LIMIT 5`);
console.log('Workers found:', JSON.stringify(res.rows, null, 2));

// Also check columns
const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='workers' ORDER BY ordinal_position`);
console.log('Worker columns:', cols.rows.map(r => r.column_name).join(', '));

// Check if hospital_records table exists
const tableCheck = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_name='hospital_records'`);
console.log('hospital_records table exists:', tableCheck.rowCount > 0);

await pool.end();
