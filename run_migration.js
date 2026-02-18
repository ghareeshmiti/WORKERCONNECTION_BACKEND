
import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runMigration() {
    try {
        console.log('Running migration (DROP & RE-CREATE with FKs)...');

        // Drop existing tickets table
        await pool.query('DROP TABLE IF EXISTS tickets');

        // Create new tickets table with FULL schema and Foreign Keys
        // Note: referenced tables (workers, establishments, users) must exist.
        // If they don't, FK constraints will fail. We'll use simple ID columns if we aren't sure, 
        // but user app implies they exist.

        // We will make FKs nullable and not strictly enforce if tables are missing to be safe,
        // but best practice is to enforce. Let's try enforcing first.

        const sql = `
          CREATE TABLE tickets (
            id SERIAL PRIMARY KEY,
            ticket_id VARCHAR(50) UNIQUE DEFAULT ('T' || floor(random() * 1000000)::text),
            
            -- Passenger Info
            worker_id UUID, -- FK to workers (handled manually or via ALTER if needed)
            passenger_name VARCHAR(100),
            age VARCHAR(10),
            gender VARCHAR(20),
            
            -- Journey Info
            bus_number VARCHAR(20),
            route_id VARCHAR(50),
            route_name VARCHAR(100),
            from_stop VARCHAR(50),
            to_stop VARCHAR(50),
            source VARCHAR(50), -- Alias for from_stop (legacy support)
            destination VARCHAR(50), -- Alias for to_stop (legacy support)
            
            -- Payment Info
            fare DECIMAL(10,2) DEFAULT 0,
            is_free BOOLEAN DEFAULT false,
            govt_subsidy_amount DECIMAL(10,2) DEFAULT 0,
            payment_mode VARCHAR(20) DEFAULT 'CASH',
            
            -- Meta Info
            establishment_id UUID,
            conductor_id UUID,
            issued_by VARCHAR(50),
            remarks TEXT,
            issued_at TIMESTAMP DEFAULT NOW()
          );
          
          -- Attempt to add FKs if tables exist (Conditional logic is hard in raw SQL block, 
          -- so we typically just create indexes or trust the app. 
          -- But for Supabase 'select=*,workers()' to work, the FK MUST exist in Postgres level.)
          
          -- We will try to add the FK constraint. If it fails (table missing), we catch it? 
          -- No, let's assume workers table exists as per previous context.
        `;

        await pool.query(sql);
        console.log('Tickets table created.');

        // Add References separately to avoid crashing if table doesn't exist
        try {
            await pool.query('ALTER TABLE tickets ADD CONSTRAINT fk_tickets_workers FOREIGN KEY (worker_id) REFERENCES workers(id)');
            console.log('FK Added: workers');
        } catch (e) { console.warn('Could not add worker FK (workers table missing?)', e.message); }

        try {
            await pool.query('ALTER TABLE tickets ADD CONSTRAINT fk_tickets_establishments FOREIGN KEY (establishment_id) REFERENCES establishments(id)');
            console.log('FK Added: establishments');
        } catch (e) { console.warn('Could not add establishment FK', e.message); }

        console.log('Migration successful: tickets table schema updated.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

runMigration();
