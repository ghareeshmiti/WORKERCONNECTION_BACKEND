
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addMissingCols() {
    try {
        console.log('Adding missing columns to workers table...');

        const queries = [
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS father_name TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS mother_name TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS caste TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS marital_status TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS bank_account_number TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS ifsc_code TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS photo_url TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS nres_member TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS trade_union_member TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS village TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS aadhaar_number TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS eshram_id TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS bocw_id TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS disability_status TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS education_level TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS skill_category TEXT`,
            `ALTER TABLE workers ADD COLUMN IF NOT EXISTS work_history TEXT`
        ];

        for (const query of queries) {
            await pool.query(query);
            console.log(`Executed: ${query}`);
        }

        console.log('All columns added successfully.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await pool.end();
    }
}

addMissingCols();
