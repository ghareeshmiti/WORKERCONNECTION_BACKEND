import pg from 'pg';
import 'dotenv/config';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='workers' AND table_schema='public' ORDER BY ordinal_position")
    .then(r => {
        console.log('Workers columns:');
        r.rows.forEach(x => console.log(`  ${x.column_name} (${x.data_type})`));
        pool.end();
    })
    .catch(e => { console.error(e.message); pool.end(); });
