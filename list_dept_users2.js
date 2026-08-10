import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    const users = await client.query(`
      SELECT email, raw_user_meta_data
      FROM auth.users 
      WHERE raw_user_meta_data->>'role' = 'DEPARTMENT' OR raw_app_meta_data->>'role' = 'DEPARTMENT'
    `);
    console.log("Department Users:");
    console.log(JSON.stringify(users.rows, null, 2));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
