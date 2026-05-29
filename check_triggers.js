import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    const triggers = await client.query(`
      SELECT trigger_name, event_object_schema, event_object_table, action_statement
      FROM information_schema.triggers 
      WHERE event_object_schema = 'auth' AND event_object_table = 'users'
    `);
    console.log(JSON.stringify(triggers.rows, null, 2));

    const functions = await client.query(`
      SELECT routine_name, routine_definition
      FROM information_schema.routines 
      WHERE routine_name LIKE '%prof%' OR routine_name LIKE '%user%'
    `);
    // Find the one that matches any triggers
    const triggerNames = triggers.rows.map(t => t.action_statement.match(/FUNCTION (.*)\(\)/)?.[1]).filter(Boolean);
    console.log("Trigger Functions used: ", triggerNames);
    
    for (const name of triggerNames) {
       const funcDef = await client.query(`
         SELECT pg_get_functiondef(p.oid)
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = $1
       `, [name.replace('public.', '')]);
       console.log(funcDef.rows[0]?.pg_get_functiondef);
    }
  } catch (err) {
    console.error('Script Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
