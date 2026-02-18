
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Creating tickets table...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_id UUID REFERENCES workers(id),
        establishment_id UUID REFERENCES establishments(id),
        bus_number TEXT NOT NULL,
        route_id TEXT,
        route_name TEXT,
        from_stop TEXT NOT NULL,
        to_stop TEXT NOT NULL,
        fare NUMERIC NOT NULL DEFAULT 0,
        is_free BOOLEAN DEFAULT false,
        govt_subsidy_amount NUMERIC DEFAULT 0,
        remarks TEXT,
        conductor_id UUID, 
        issued_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Add indexes for performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tickets_establishment_id ON tickets(establishment_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tickets_worker_id ON tickets(worker_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tickets_issued_at ON tickets(issued_at);`);

    console.log('Tickets table created successfully.');

    // RLS Policies (if RLS is enabled on other tables, likely needed here too, but for now we keep it open or follow pattern)
    // Checking if RLS is enabled on other tables might be good, but standard is usually enabling it.
    // For this script, we'll just create the table. If RLS is active on database, we might need to enable it and add policies.
    // Let's check establishments RLS just in case.
    
    // Enabling RLS
    await client.query(`ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;`);
    
    // Policy: Allow all for now (development) or specific logic.
    // Since we are using service role key in backend, RLS might not block us, but for client side it matters.
    // Let's add a policy that allows authenticated users to read/insert.
    
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE tablename = 'tickets' AND policyname = 'Enable read access for all users'
        ) THEN
          CREATE POLICY "Enable read access for all users" ON tickets FOR SELECT USING (true);
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE tablename = 'tickets' AND policyname = 'Enable insert for authenticated users only'
        ) THEN
          CREATE POLICY "Enable insert for authenticated users only" ON tickets FOR INSERT WITH CHECK (auth.role() = 'authenticated');
        END IF;
      END $$;
    `);

    console.log('RLS policies applied.');

  } catch (err) {
    console.error('Error creating tickets table:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
