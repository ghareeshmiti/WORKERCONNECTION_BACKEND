/**
 * fix_employee_profile2.js
 * Creates a profile row for employ@aphealth.com using correct profiles schema.
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
        const empAuthId = empAuth.rows[0].id;
        console.log(`Employee auth ID: ${empAuthId}`);

        // Get the Guntur GH establishment
        const hosp = await client.query(
            `SELECT id, department_id FROM establishments WHERE email = 'guntur.gh@aphealth.com' LIMIT 1`
        );
        const estId = hosp.rows[0].id;
        const deptId = hosp.rows[0].department_id;
        console.log(`Hospital ID: ${estId}, Dept ID: ${deptId}`);

        // Check if profile already exists (by auth_user_id)
        const existing = await client.query(
            `SELECT id FROM profiles WHERE auth_user_id = $1`, [empAuthId]
        );

        if (existing.rowCount > 0) {
            await client.query(
                `UPDATE profiles SET establishment_id = $1, department_id = $2, updated_at = NOW() WHERE auth_user_id = $3`,
                [estId, deptId, empAuthId]
            );
            console.log(`✅ Updated existing profile`);
        } else {
            // Generate a new UUID for the profile id
            const newId = crypto.randomUUID();
            await client.query(
                `INSERT INTO profiles (id, auth_user_id, establishment_id, department_id, full_name, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
                [newId, empAuthId, estId, deptId, 'Hospital Staff']
            );
            console.log(`✅ Created new profile (id: ${newId})`);
        }

        // Also update auth metadata so it's available in the JWT
        await client.query(
            `UPDATE auth.users SET 
        raw_user_meta_data = raw_user_meta_data || $1::jsonb,
        raw_app_meta_data = raw_app_meta_data || $2::jsonb,
        updated_at = NOW()
       WHERE id = $3`,
            [
                JSON.stringify({ establishment_id: estId, department_id: deptId, dept_code: 'APHEALTH' }),
                JSON.stringify({ role: 'EMPLOYEE', establishment_id: estId, department_id: deptId, dept_code: 'APHEALTH' }),
                empAuthId
            ]
        );
        console.log(`✅ Updated auth metadata`);

        // Verify
        const verify = await client.query(
            `SELECT p.id, p.auth_user_id, p.establishment_id, p.department_id, e.name as hospital, d.code as dept_code
       FROM profiles p
       LEFT JOIN establishments e ON e.id = p.establishment_id
       LEFT JOIN departments d ON d.id = p.department_id
       WHERE p.auth_user_id = $1`,
            [empAuthId]
        );
        console.log('\n=== Profile Verification ===');
        console.log(JSON.stringify(verify.rows[0], null, 2));
        console.log('\n✅ employ@aphealth.com will now route to HospitalEntry (APHEALTH)');

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
