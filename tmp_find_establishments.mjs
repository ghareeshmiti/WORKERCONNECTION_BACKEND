import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  try {
    const gandhi = await pool.query("SELECT id, name FROM establishments WHERE name ILIKE '%gandhi%' ORDER BY name");
    console.log('Gandhi matches:', gandhi.rowCount);
    gandhi.rows.forEach(r => console.log(r));

    const guntur = await pool.query("SELECT id, name FROM establishments WHERE name ILIKE '%guntur%' ORDER BY name");
    console.log('Guntur matches:', guntur.rowCount);
    guntur.rows.forEach(r => console.log(r));
  } finally {
    await pool.end();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
