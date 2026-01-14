
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function debugAuth() {
    try {
        console.log('--- AUTH USERS (admin) ---');
        // We can't query auth.users directly easily from here unless we are superuser or using service key in client.
        // But the provided connection string is usually postgres role which can see generic stuff, but maybe not auth.
        // Let's try querying auth.users. If it fails, I'll use the supabase admin client if available or just infer from public.

        // Actually, let's try to simulate what the previous scripts did.
        const authRes = await pool.query(`
            SELECT id, email, raw_user_meta_data 
            FROM auth.users 
            WHERE email = 'vijayawada.welfare@gmail.com'
        `);
        console.log(JSON.stringify(authRes.rows, null, 2));

        console.log('\n--- DEPARTMENTS ---');
        const deptRes = await pool.query('SELECT * FROM departments');
        console.log(JSON.stringify(deptRes.rows, null, 2));

        console.log('\n--- ESTABLISHMENTS ---');
        const estRes = await pool.query('SELECT * FROM establishments');
        console.log(JSON.stringify(estRes.rows, null, 2));

    } catch (e) {
        console.error('Error querying:', e);
    } finally {
        await pool.end();
    }
}

debugAuth();
