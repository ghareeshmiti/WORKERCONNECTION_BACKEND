import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    const users = await client.query(`
      SELECT email, raw_user_meta_data->>'role' as role, raw_user_meta_data->>'dept_code' as dept
      FROM auth.users 
      WHERE raw_user_meta_data->>'role' = 'DEPARTMENT' OR raw_user_meta_data->>'role' = 'APHEALTH'
    `);
    console.table(users.rows);

    const healthUsers = await client.query(`
      SELECT email, raw_user_meta_data->>'role' as role, raw_user_meta_data->>'dept_code' as dept 
      FROM auth.users 
      WHERE email LIKE '%health%' OR email LIKE '%dept%' OR email LIKE '%aphealth%'
    `);
    console.table(healthUsers.rows);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
