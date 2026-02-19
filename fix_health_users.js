/**
 * fix_health_users.js
 * Fixes the health portal users:
 * 1. Creates guntur.gh@aphealth.com in auth.users if missing
 * 2. Ensures the auth user ID matches the establishments table ID
 * 3. Links all users to their correct department/establishment records
 */
import pg from 'pg';
import 'dotenv/config';
import crypto from 'crypto';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    const client = await pool.connect();
    try {
        console.log('=== Fixing AP Health Portal Users ===\n');

        // --- 1. Fix guntur.gh@aphealth.com ---
        const hospEmail = 'guntur.gh@aphealth.com';
        const hospPassword = 'Test@1234';

        // Get the establishment record
        const hospRec = await client.query(
            `SELECT id, name FROM establishments WHERE email = $1 LIMIT 1`,
            [hospEmail]
        );
        if (hospRec.rowCount === 0) throw new Error('Hospital establishment record not found!');
        const hospDbId = hospRec.rows[0].id;
        console.log(`Hospital DB ID: ${hospDbId}`);

        // Check if auth user exists
        const hospAuth = await client.query(
            `SELECT id, email_confirmed_at FROM auth.users WHERE email = $1 LIMIT 1`,
            [hospEmail]
        );

        if (hospAuth.rowCount === 0) {
            // Create auth user with the SAME ID as the establishment record
            console.log(`Creating auth user for ${hospEmail} with ID: ${hospDbId}`);
            const now = new Date().toISOString();
            await client.query(`
        INSERT INTO auth.users (
          id, instance_id, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          role, aud, confirmation_token, recovery_token, email_change_token_new, email_change
        ) VALUES (
          $1, '00000000-0000-0000-0000-000000000000', $2,
          crypt($3, gen_salt('bf')), $4,
          $5::jsonb, '{}'::jsonb, $6, $6,
          'authenticated', 'authenticated', '', '', '', ''
        )
      `, [hospDbId, hospEmail, hospPassword, now, JSON.stringify({ role: 'ESTABLISHMENT_ADMIN' }), now]);
            console.log(`✅ Created auth user for ${hospEmail}`);
        } else {
            const authId = hospAuth.rows[0].id;
            console.log(`Auth user exists for ${hospEmail}: ${authId}`);

            if (authId !== hospDbId) {
                // IDs don't match — update the establishment to use the auth ID
                console.log(`⚠️  ID mismatch! Updating establishment ID from ${hospDbId} to ${authId}`);
                await client.query(`UPDATE establishments SET id = $1 WHERE id = $2`, [authId, hospDbId]);
                // Also update hospital_records references
                await client.query(`UPDATE hospital_records SET establishment_id = $1 WHERE establishment_id = $2`, [authId, hospDbId]);
                await client.query(`UPDATE health_appointments SET establishment_id = $1 WHERE establishment_id = $2`, [authId, hospDbId]);
                await client.query(`UPDATE health_checkups SET establishment_id = $1 WHERE establishment_id = $2`, [authId, hospDbId]);
                console.log(`✅ Updated establishment and all related records`);
            }

            // Confirm email if not confirmed
            if (!hospAuth.rows[0].email_confirmed_at) {
                await client.query(`UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW() WHERE email = $1`, [hospEmail]);
                console.log(`✅ Confirmed email for ${hospEmail}`);
            }

            // Set role in app_meta_data
            await client.query(
                `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"ESTABLISHMENT_ADMIN"}'::jsonb, updated_at = NOW() WHERE email = $1`,
                [hospEmail]
            );
        }

        // --- 2. Fix aphealth@gmail.com ---
        const deptEmail = 'aphealth@gmail.com';
        const deptAuth = await client.query(`SELECT id, email_confirmed_at FROM auth.users WHERE email = $1`, [deptEmail]);
        if (deptAuth.rowCount > 0) {
            const authId = deptAuth.rows[0].id;
            // Ensure department record has this ID
            const deptRec = await client.query(`SELECT id FROM departments WHERE code = 'APHEALTH'`);
            if (deptRec.rowCount > 0 && deptRec.rows[0].id !== authId) {
                console.log(`⚠️  Dept ID mismatch! Updating department ID`);
                await client.query(`UPDATE departments SET id = $1 WHERE code = 'APHEALTH'`, [authId]);
            }
            // Confirm email
            if (!deptAuth.rows[0].email_confirmed_at) {
                await client.query(`UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW() WHERE email = $1`, [deptEmail]);
            }
            await client.query(
                `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"DEPARTMENT_ADMIN"}'::jsonb, updated_at = NOW() WHERE email = $1`,
                [deptEmail]
            );
            console.log(`✅ ${deptEmail} OK (ID: ${authId})`);
        }

        // --- 3. Fix employ@aphealth.com ---
        const empEmail = 'employ@aphealth.com';
        const empAuth = await client.query(`SELECT id, email_confirmed_at FROM auth.users WHERE email = $1`, [empEmail]);
        if (empAuth.rowCount > 0) {
            const authId = empAuth.rows[0].id;
            if (!empAuth.rows[0].email_confirmed_at) {
                await client.query(`UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW() WHERE email = $1`, [empEmail]);
            }
            await client.query(
                `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"EMPLOYEE"}'::jsonb, updated_at = NOW() WHERE email = $1`,
                [empEmail]
            );
            console.log(`✅ ${empEmail} OK (ID: ${authId})`);
        }

        // --- Final verification ---
        console.log('\n=== Final Verification ===');
        const allAuth = await client.query(
            `SELECT email, id, email_confirmed_at, raw_app_meta_data->>'role' as role FROM auth.users WHERE email = ANY($1)`,
            [['aphealth@gmail.com', 'guntur.gh@aphealth.com', 'employ@aphealth.com']]
        );
        allAuth.rows.forEach(u => {
            console.log(`${u.email}`);
            console.log(`  ID: ${u.id} | Confirmed: ${u.email_confirmed_at ? '✅' : '❌'} | Role: ${u.role}`);
        });

        console.log('\n=== Login Credentials ===');
        console.log('  aphealth@gmail.com         / Test@1234  (Dept Admin)');
        console.log('  guntur.gh@aphealth.com     / Test@1234  (Hospital Admin)');
        console.log('  employ@aphealth.com        / Test@1234  (Employee)');

    } catch (err) {
        console.error('Error:', err.message);
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
