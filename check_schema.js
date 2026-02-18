
import 'dotenv/config';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
    try {
        console.log('Checking schema for table: tickets');
        const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tickets';
    `);

        if (res.rows.length === 0) {
            console.log('Table "tickets" does not exist (or has no columns).');
        } else {
            console.log('Columns found:', res.rows);
        }
    } catch (err) {
        console.error('Schema check failed:', err);
    } finally {
        await pool.end();
    }
}

checkSchema();
