import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  try {
    console.log('--- profiles with establishment_id ---');
    const res = await pool.query(`SELECT id, auth_user_id, establishment_id, department_id, worker_id FROM profiles WHERE establishment_id IS NOT NULL LIMIT 20`);
    console.table(res.rows);

    console.log('--- profiles with NULL establishment_id (limit 20)---');
    const res2 = await pool.query(`SELECT id, auth_user_id, establishment_id, department_id, worker_id FROM profiles WHERE establishment_id IS NULL LIMIT 20`);
    console.table(res2.rows);
  } finally {
    await pool.end();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
