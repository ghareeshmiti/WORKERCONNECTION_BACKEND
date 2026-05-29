import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    const email = 'outpatient@health.com';
    console.log(`Hard deleting ${email}...`);
    
    const user = await client.query(`SELECT id FROM auth.users WHERE email = $1`, [email]);
    if (user.rowCount > 0) {
      const authUserId = user.rows[0].id;
      console.log(`Found user ${authUserId}. Deleting from profiles...`);
      await client.query(`DELETE FROM profiles WHERE auth_user_id = $1`, [authUserId]);
      
      console.log(`Deleting from auth.users...`);
      await client.query(`DELETE FROM auth.users WHERE id = $1`, [authUserId]);
      console.log(`Hard delete complete.`);
    } else {
      console.log(`User already deleted.`);
    }
  } catch (err) {
    console.error('Script Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
