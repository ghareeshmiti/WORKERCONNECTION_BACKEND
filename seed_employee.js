
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const { Pool } = pg;

const supabaseUrl = process.env.SUPABASE_URL || 'https://seecqtxhpsostjniabeo.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
// SERVICE_ROLE_KEY is ideally needed for admin user updates, but we'll try with what we have.
// If anon key doesn't allow user creation freely, we might need the service role key from .env if available.
const supabaseServiceKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function seedEmployee() {
    const client = await pool.connect();
    try {
        console.log('Seeding Employee User...');

        // 1. Get RTC Department ID
        const deptRes = await client.query("SELECT id FROM departments WHERE code = 'RTC' LIMIT 1");
        if (deptRes.rowCount === 0) {
            console.error("RTC Department not found. Run seed_rtc_data.js first.");
            return;
        }
        const deptId = deptRes.rows[0].id;
        console.log(`Found RTC Department ID: ${deptId}`);

        const email = 'conductor@apsrtc.in';
        const password = 'Test@1234';

        // 2. Create User with Metadata
        // We use admin.createUser to validly set metadata or signUp if public
        // Using signUp first as it's safer with anon key

        // 2. Direct SQL approach to bypass API rate limits/confirmation issues

        // Check if user exists in auth.users
        const userCheck = await client.query("SELECT id, raw_user_meta_data FROM auth.users WHERE email = $1", [email]);

        if (userCheck.rowCount > 0) {
            console.log(`User ${email} found in DB. ID: ${userCheck.rows[0].id}`);
            // Update metadata directly
            const currentMeta = userCheck.rows[0].raw_user_meta_data || {};
            const newMeta = { ...currentMeta, role: 'employee', department_id: deptId, full_name: 'Conductor Ravi' };

            await client.query("UPDATE auth.users SET raw_user_meta_data = $1, email_confirmed_at = NOW() WHERE email = $2", [JSON.stringify(newMeta), email]);
            console.log("User metadata and confirmation status updated via SQL.");
        } else {
            console.log("User not found in DB. Creating via API (fallback)...");
            // If SQL check failed (maybe permissions?), try API or just manually insert if we could (but password hashing is hard)
            // Let's try API one last time, or assume we need to use a real email if confirmation is forced.

            // Actually, if we have the postgres connection, we can just INSERT into auth.users! 
            // But valid password hash generation (bcrypt) is needed. `pgcrypto` extension is usually available.

            // For now, let's try to trust the API creation worked but maybe just needs confirmation.
            // If the API creation part failed previously, we might be stuck.

            // Let's try to INSERT a dummy user with a known hash if we can.
            // Or just tell the user to sign up via the UI?

            // Let's try to update the password of the existing user if it exists but I missed it? No, rowCount was 0.

            console.log("Attempting creation via Supabase API...");
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: { role: 'employee', department_id: deptId, full_name: 'Conductor Ravi' }
                }
            });

            if (data?.user) {
                console.log("User created via API. Now auto-confirming via SQL...");
                await client.query("UPDATE auth.users SET email_confirmed_at = NOW(), raw_user_meta_data = $1 WHERE id = $2",
                    [JSON.stringify({ role: 'employee', department_id: deptId, full_name: 'Conductor Ravi' }), data.user.id]);
                console.log("User confirmed via SQL.");
            } else {
                console.error("API Creation failed:", error?.message);
            }
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

seedEmployee();
