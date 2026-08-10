import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  const client = await pool.connect();
  try {
    const email = 'outpatient@health.com';
    const password = 'Test@1234';

    console.log(`Getting Gandhi Hospital ID...`);
    const hosp = await client.query(`SELECT id, department_id FROM establishments WHERE name = 'Gandhi Hospital' LIMIT 1`);
    if (hosp.rowCount === 0) throw new Error("Gandhi Hospital not found in DB");
    
    const estId = hosp.rows[0].id;
    const deptId = hosp.rows[0].department_id;
    
    const appMetaData = { role: 'EMPLOYEE', establishment_id: estId, department_id: deptId, dept_code: 'APHEALTH' };
    const userMetaData = { establishment_id: estId, department_id: deptId, dept_code: 'APHEALTH' };

    console.log(`Checking if user exists in DB directly...`);
    const dbUser = await client.query(`SELECT id FROM auth.users WHERE email = $1`, [email]);
    
    let authUserId;
    if (dbUser.rowCount > 0) {
      authUserId = dbUser.rows[0].id;
      console.log(`User exists! ID: ${authUserId}. Updating via Admin API...`);
      const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        password: password,
        app_metadata: appMetaData,
        user_metadata: userMetaData,
      });
      if (error) console.error("Admin API Update Error:", error.message);
    } else {
      console.log(`User does not exist in DB. Creating via Admin API...`);
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        app_metadata: appMetaData,
        user_metadata: userMetaData,
      });
      if (error) {
        console.error("Admin API Create Error:", error.message);
      } else {
        authUserId = data.user.id;
        console.log(`Created new auth user ID: ${authUserId}`);
      }
    }

    if (authUserId) {
      console.log(`Upserting profile...`);
      const existingProfile = await client.query(`SELECT id FROM profiles WHERE auth_user_id = $1`, [authUserId]);
      
      if (existingProfile.rowCount > 0) {
        await client.query(
          `UPDATE profiles SET establishment_id = $1, department_id = $2, full_name = $3, updated_at = NOW() WHERE auth_user_id = $4`,
          [estId, deptId, 'Gandhi OPD Reception', authUserId]
        );
      } else {
        const newId = crypto.randomUUID();
        await client.query(
          `INSERT INTO profiles (id, auth_user_id, establishment_id, department_id, full_name, created_at, updated_at) 
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
          [newId, authUserId, estId, deptId, 'Gandhi OPD Reception']
        );
      }
      console.log(`✅ Success! User fully mapped correctly.`);
    }

  } catch (err) {
    console.error('Script Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
