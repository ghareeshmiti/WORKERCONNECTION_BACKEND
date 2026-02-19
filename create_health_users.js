/**
 * create_health_users.js
 * Creates Supabase auth users directly via SQL (bypasses service role key requirement).
 * Uses the same pattern as existing RTC users.
 */
import pg from 'pg';
import 'dotenv/config';
import crypto from 'crypto';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Users to create
const USERS = [
    { email: 'aphealth@gmail.com', password: 'Test@1234', role: 'DEPARTMENT_ADMIN', label: 'AP Health Dept Admin' },
    { email: 'guntur.gh@aphealth.com', password: 'Test@1234', role: 'ESTABLISHMENT_ADMIN', label: 'Guntur GH Admin' },
    { email: 'employ@aphealth.com', password: 'Test@1234', role: 'EMPLOYEE', label: 'Hospital Employee' },
];

// Simple bcrypt-compatible hash using Supabase's expected format
// Supabase uses bcrypt $2a$ with cost 10
async function hashPassword(password) {
    // Use crypto to create a bcrypt-like hash via the DB function
    // We'll let Postgres do the hashing via crypt()
    return password; // We'll pass raw and let SQL handle it
}

async function run() {
    const client = await pool.connect();
    try {
        console.log('Creating AP Health Supabase auth users...\n');

        for (const user of USERS) {
            // Check if user already exists
            const existing = await client.query(
                `SELECT id, email, email_confirmed_at FROM auth.users WHERE email = $1 LIMIT 1`,
                [user.email]
            );

            if (existing.rowCount > 0) {
                const u = existing.rows[0];
                if (!u.email_confirmed_at) {
                    // Confirm the email if not confirmed
                    await client.query(
                        `UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1`,
                        [u.id]
                    );
                    console.log(`✅ Confirmed email for existing user: ${user.email} (ID: ${u.id})`);
                } else {
                    console.log(`✅ User already exists and confirmed: ${user.email} (ID: ${u.id})`);
                }

                // Update app_metadata role
                await client.query(
                    `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || $1::jsonb, updated_at = NOW() WHERE id = $2`,
                    [JSON.stringify({ role: user.role }), u.id]
                );
                continue;
            }

            // Create new user with confirmed email
            const userId = crypto.randomUUID();
            const now = new Date().toISOString();

            await client.query(`
        INSERT INTO auth.users (
          id,
          instance_id,
          email,
          encrypted_password,
          email_confirmed_at,
          raw_app_meta_data,
          raw_user_meta_data,
          created_at,
          updated_at,
          role,
          aud,
          confirmation_token,
          recovery_token,
          email_change_token_new,
          email_change
        ) VALUES (
          $1,
          '00000000-0000-0000-0000-000000000000',
          $2,
          crypt($3, gen_salt('bf')),
          $4,
          $5::jsonb,
          '{}'::jsonb,
          $6,
          $6,
          'authenticated',
          'authenticated',
          '',
          '',
          '',
          ''
        )
      `, [
                userId,
                user.email,
                user.password,
                now,
                JSON.stringify({ role: user.role }),
                now
            ]);

            console.log(`✅ Created user: ${user.label}`);
            console.log(`   Email: ${user.email}`);
            console.log(`   ID:    ${userId}\n`);
        }

        console.log('\n=== All health users ready! ===');
        console.log('Login credentials:');
        USERS.forEach(u => console.log(`  ${u.label}: ${u.email} / ${u.password}`));

    } catch (err) {
        console.error('Error:', err.message);
        if (err.message.includes('pgcrypto') || err.message.includes('crypt')) {
            console.log('\nHint: pgcrypto extension may not be enabled. Trying alternative...');
            await tryAlternativeMethod(client);
        }
    } finally {
        client.release();
        await pool.end();
    }
}

async function tryAlternativeMethod(client) {
    console.log('\nTrying to enable pgcrypto and retry...');
    try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
        console.log('pgcrypto enabled. Please run the script again.');
    } catch (e) {
        console.error('Could not enable pgcrypto:', e.message);
        console.log('\n--- MANUAL STEPS ---');
        console.log('Go to your Supabase Dashboard → Authentication → Users → Add User:');
        USERS.forEach(u => console.log(`  Email: ${u.email}  Password: ${u.password}`));
    }
}

run();
