/**
 * fix_employee_profile.js
 * Creates a profile row for employ@aphealth.com so the auth context
 * can find their establishment_id and route them to HospitalEntry.
 */
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    const client = await pool.connect();
    try {
        // Get the employee auth user ID
        const empAuth = await client.query(
            `SELECT id FROM auth.users WHERE email = 'employ@aphealth.com' LIMIT 1`
        );
        if (empAuth.rowCount === 0) throw new Error('Employee auth user not found');
        const empId = empAuth.rows[0].id;
        console.log(`Employee auth ID: ${empId}`);

        // Get the Guntur GH establishment
        const hosp = await client.query(
            `SELECT id, department_id FROM establishments WHERE email = 'guntur.gh@aphealth.com' LIMIT 1`
        );
        if (hosp.rowCount === 0) throw new Error('Hospital establishment not found');
        const estId = hosp.rows[0].id;
        const deptId = hosp.rows[0].department_id;
        console.log(`Hospital ID: ${estId}, Dept ID: ${deptId}`);

        // Check if profiles table exists and has the right columns
        const cols = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'profiles' AND table_schema = 'public'
    `);
        console.log('Profile columns:', cols.rows.map(r => r.column_name));

        // Check if profile already exists
        const existing = await client.query(`SELECT id FROM profiles WHERE id = $1`, [empId]);

        if (existing.rowCount > 0) {
            // Update
            await client.query(
                `UPDATE profiles SET establishment_id = $1, department_id = $2, updated_at = NOW() WHERE id = $3`,
                [estId, deptId, empId]
            );
            console.log(`✅ Updated profile for employ@aphealth.com`);
        } else {
            // Insert
            await client.query(
                `INSERT INTO profiles (id, establishment_id, department_id, created_at, updated_at) 
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET establishment_id = $2, department_id = $3, updated_at = NOW()`,
                [empId, estId, deptId]
            );
            console.log(`✅ Created profile for employ@aphealth.com`);
        }

        // Also update user_metadata in auth.users so it's available immediately
        await client.query(
            `UPDATE auth.users SET 
        raw_user_meta_data = raw_user_meta_data || $1::jsonb,
        raw_app_meta_data = raw_app_meta_data || $2::jsonb,
        updated_at = NOW()
       WHERE id = $3`,
            [
                JSON.stringify({ establishment_id: estId, department_id: deptId, dept_code: 'APHEALTH' }),
                JSON.stringify({ role: 'EMPLOYEE', establishment_id: estId, department_id: deptId, dept_code: 'APHEALTH' }),
                empId
            ]
        );
        console.log(`✅ Updated auth metadata for employ@aphealth.com`);

        console.log('\n=== Done! ===');
        console.log(`employ@aphealth.com will now route to HospitalEntry`);

    } catch (err) {
        console.error('Error:', err.message);
        // Show profiles table structure
        try {
            const t = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='profiles' AND table_schema='public'`);
            console.log('Profiles table:', t.rows);
        } catch (e2) {
            console.log('Could not read profiles table:', e2.message);
        }
    } finally {
        client.release();
        await pool.end();
    }
}

run();
