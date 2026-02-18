
require('dotenv').config({ path: './server/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPolicies(table) {
    console.log(`Checking policies for table: ${table}`);

    // Query pg_policies via RPC or direct SQL if possible. 
    // Since we don't have direct SQL via client easily without custom functions, 
    // we can try to just READ from the table as an anon user to see if it blocks.

    // But to list policies, we might need a postgres connection.
    // Let's rely on the user report: "Empty data". 
    // Let's try to enable public read access on 'tickets' first as a blanket fix.

    // We can use the pg client for policy management if we have the connection string.
    // The connection string IS in .env
}

// Pivot: Let's just create a script to ENABLE policies using the PG client.
const pg = require('pg');
const { Client } = pg;

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function enablePolicies() {
    try {
        await client.connect();

        // 1. Enable RLS on tickets
        await client.query(`ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;`);

        // 2. Drop existing policies to be safe
        // Note: This matches the user's previous successful fix for 'workers'
        await client.query(`DROP POLICY IF EXISTS "Public Read Tickets" ON tickets;`);
        await client.query(`DROP POLICY IF EXISTS "Authenticated Insert Tickets" ON tickets;`);

        // 3. Create Public Read Policy (or specialized)
        // For Dashboard: Department Admin needs to read. 
        // "Public Read" is easiest for debugging, but we can refine later.
        await client.query(`
      CREATE POLICY "Public Read Tickets"
      ON tickets
      FOR SELECT
      USING (true);
    `);

        // 4. Create Insert Policy (Authenticated only)
        await client.query(`
      CREATE POLICY "Authenticated Insert Tickets"
      ON tickets
      FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
    `);

        console.log("Policies updated for 'tickets' table.");

    } catch (e) {
        console.error("Error updating policies:", e);
    } finally {
        await client.end();
    }
}

enablePolicies();
