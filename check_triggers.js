
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkDeep() {
    try {
        console.log('--- Functions in public schema ---');
        const funcs = await pool.query(`
            SELECT routine_name, routine_definition 
            FROM information_schema.routines 
            WHERE routine_schema = 'public'
        `);
        funcs.rows.forEach(r => console.log(`Function: ${r.routine_name}`));

        console.log('\n--- ALL Triggers (information_schema) ---');
        const triggers = await pool.query(`
            SELECT 
                trigger_schema,
                trigger_name,
                event_object_schema,
                event_object_table,
                action_statement
            FROM information_schema.triggers
        `);
        console.table(triggers.rows);

        console.log('\n--- Checking for extensions ---');
        const exts = await pool.query('SELECT * FROM pg_extension');
        exts.rows.forEach(r => console.log(`Ext: ${r.extname} (v${r.extversion})`));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkDeep();
