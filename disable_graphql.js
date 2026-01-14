
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function disableGraphQL() {
    try {
        console.log('Attempting to drop pg_graphql extension...');
        await pool.query('DROP EXTENSION IF EXISTS pg_graphql CASCADE');
        console.log('Success: pg_graphql dropped.');
    } catch (e) {
        console.error('Error dropping pg_graphql:', e.message);
        console.log('You might need to disable it in the Supabase Dashboard -> Database -> Extensions.');
    } finally {
        await pool.end();
    }
}

disableGraphQL();
