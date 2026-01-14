import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const { Pool } = pg;
console.log('DB URL:', process.env.DATABASE_URL ? 'Found' : 'Missing');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function addRejectionColumn() {
    const client = await pool.connect();
    try {
        console.log('Checking workers table for rejection_reason column...');

        // Check if column exists
        const checkQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='workers' AND column_name='rejection_reason';
    `;
        const res = await client.query(checkQuery);

        if (res.rows.length === 0) {
            console.log('Adding rejection_reason column...');
            await client.query('ALTER TABLE workers ADD COLUMN rejection_reason TEXT;');
            console.log('Column added successfully.');
        } else {
            console.log('Column rejection_reason already exists.');
        }
    } catch (err) {
        console.error('Error adding column:', err);
    } finally {
        client.release();
        pool.end();
    }
}

addRejectionColumn();
