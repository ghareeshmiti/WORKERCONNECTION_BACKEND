
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function debugSchema() {
    try {
        console.log('Checking Tables in public...');
        const tablesRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.table(tablesRes.rows);

        console.log('\nChecking Triggers on auth.users...');
        // Note: We might not have permission to read information_schema.triggers for auth schema directly depending on role,
        // but 'postgres' user usually can.
        const triggersRes = await pool.query(`
            SELECT event_object_schema as table_schema,
                   event_object_table as table_name,
                   trigger_schema,
                   trigger_name,
                   action_timing,
                   event_manipulation,
                   action_statement,
                   action_orientation
            FROM information_schema.triggers
            WHERE event_object_table = 'users' 
            AND event_object_schema = 'auth'
        `);
        console.table(triggersRes.rows);

        console.log('\nChecking active extensions...');
        const extRes = await pool.query('SELECT * FROM pg_extension');
        console.table(extRes.rows);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

debugSchema();
