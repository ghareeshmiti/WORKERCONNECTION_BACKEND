import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    const email = 'outpatient@health.com';
    
    // Get correct APHEALTH dept ID
    const dept = await client.query(`SELECT id, code FROM departments WHERE code = 'APHEALTH' LIMIT 1`);
    if (dept.rowCount === 0) throw new Error("APHEALTH dept not found");
    const deptId = dept.rows[0].id;

    // Get Gandhi Hospital ID
    const hosp = await client.query(`SELECT id FROM establishments WHERE name = 'Gandhi Hospital' LIMIT 1`);
    const estId = hosp.rows[0].id;

    console.log(`Setting auth metadata to Dept ID: ${deptId}, Est ID: ${estId} ...`);

    // Update user auth metadata
    await client.query(`
      UPDATE auth.users 
      SET 
        raw_app_meta_data = jsonb_set(
                              jsonb_set(
                                jsonb_set(raw_app_meta_data, '{department_id}', $1::jsonb),
                                '{establishment_id}', $2::jsonb
                              ),
                              '{dept_code}', '"APHEALTH"'::jsonb
                            ),
        raw_user_meta_data = jsonb_set(
                              jsonb_set(
                                jsonb_set(raw_user_meta_data, '{department_id}', $1::jsonb),
                                '{establishment_id}', $2::jsonb
                              ),
                              '{dept_code}', '"APHEALTH"'::jsonb
                            )
      WHERE email = $3
    `, [`"${deptId}"`, `"${estId}"`, email]);

    await client.query(`UPDATE profiles SET department_id = $1 WHERE auth_user_id IN (SELECT id FROM auth.users WHERE email=$2)`, [deptId, email]);

    console.log('✅ Updated auth metadata and profiles table!');

  } catch (err) {
    console.error('Script Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
