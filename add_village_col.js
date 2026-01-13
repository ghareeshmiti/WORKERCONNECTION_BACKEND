
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addVillage() {
    try {
        await pool.query('ALTER TABLE workers ADD COLUMN village TEXT');
        console.log('Added village column to workers table.');
    } catch (e) {
        if (e.message.includes('already exists')) {
            console.log('Column village already exists.');
        } else {
            console.error(e);
        }
    } finally {
        await pool.end();
    }
}

addVillage();
