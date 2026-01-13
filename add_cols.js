
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log("Adding missing columns to workers table...");

        await pool.query(`
      DO $$ 
      BEGIN 
        BEGIN
            ALTER TABLE workers ADD COLUMN aadhaar_number TEXT;
        EXCEPTION
            WHEN duplicate_column THEN RAISE NOTICE 'aadhaar_number already exists in workers.';
        END;

        BEGIN
            ALTER TABLE workers ADD COLUMN gender TEXT;
        EXCEPTION
            WHEN duplicate_column THEN RAISE NOTICE 'gender already exists in workers.';
        END;

        BEGIN
            ALTER TABLE workers ADD COLUMN dob TEXT; -- Using TEXT for simplicity or DATE
        EXCEPTION
            WHEN duplicate_column THEN RAISE NOTICE 'dob already exists in workers.';
        END;
        
        -- phone already exists likely, but just in case
        BEGIN
            ALTER TABLE workers ADD COLUMN phone TEXT;
        EXCEPTION
            WHEN duplicate_column THEN RAISE NOTICE 'phone already exists in workers.';
        END;
      END $$;
    `);

        console.log("Migration complete.");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        await pool.end();
    }
}

migrate();
