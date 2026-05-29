import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    const email = 'outpatient@health.com';
    const authUser = await client.query(`SELECT id FROM auth.users WHERE email = $1`, [email]);
    if (authUser.rowCount > 0) {
      const id = authUser.rows[0].id;
      await client.query(`UPDATE profiles SET full_name = 'Gandhi Hospital' WHERE auth_user_id = $1`, [id]);
      console.log('✅ Updated profile name to Gandhi Hospital');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
