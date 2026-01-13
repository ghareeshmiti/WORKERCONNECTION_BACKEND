
import pg from 'pg';
const { Client } = pg;

const configs = [
    {
        name: 'Session Pooler (Port 5432)',
        url: 'postgresql://postgres.seecqtxhpsostjniabeo:WorkerConnect%40Fido@aws-0-ap-south-1.pooler.supabase.com:5432/postgres'
    },
    {
        name: 'Transaction Pooler (Port 6543)',
        url: 'postgresql://postgres.seecqtxhpsostjniabeo:WorkerConnect%40Fido@aws-0-ap-south-1.pooler.supabase.com:6543/postgres'
    },
    {
        name: 'Direct (IPv4 Force Attempt - likely fail)',
        url: 'postgresql://postgres:WorkerConnect%40Fido@db.seecqtxhpsostjniabeo.supabase.co:5432/postgres'
    }
];

async function testParams() {
    for (const config of configs) {
        console.log(`\nTesting: ${config.name}`);
        const client = new Client({
            connectionString: config.url,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 5000
        });

        try {
            await client.connect();
            console.log('SUCCESS! Connected.');
            const res = await client.query('SELECT NOW()');
            console.log('Connected successfully:', res.rows[0]);

            const tables = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
    `);
            console.log('Tables:', tables.rows.map(r => r.table_name));

            const types = await client.query(`
        SELECT typname 
        FROM pg_type 
        WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `);
            console.log('Types:', types.rows.map(r => r.typname));

            await client.end();
            break; // Stop on first success
        } catch (e) {
            console.error('FAILED.');
            console.error('Code:', e.code);
            console.error('Message:', e.message);
            if (e.detail) console.error('Detail:', e.detail);
        }
    }
}

testParams();
