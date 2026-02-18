
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function linkRTCAdmin() {
    const client = await pool.connect();
    try {
        console.log('Linking APSRTC Admin User to RTC Department...');

        // 1. Get Auth User ID for apsrtc@gmail.com
        // We can't query auth.users directly easily (maybe), but we can try insert into profiles and rely on auth_user_id from context if we were in supabase, but here we are node.
        // Wait, confirm_emails.js successfully updated auth.users, so we HAVE access to auth schema.

        const userRes = await client.query("SELECT id, email FROM auth.users WHERE email = 'apsrtc@gmail.com'");
        if (userRes.rowCount === 0) {
            console.error('User apsrtc@gmail.com NOT found in auth.users');
            return;
        }
        const userId = userRes.rows[0].id;
        console.log(`Found User ID: ${userId}`);

        // 2. Get Department ID for RTC
        const deptRes = await client.query("SELECT id, name FROM departments WHERE code = 'RTC'");
        if (deptRes.rowCount === 0) {
            console.error('Department RTC NOT found');
            return;
        }
        const deptId = deptRes.rows[0].id;
        console.log(`Found Department ID: ${deptId}`);

        // 3. Check/Insert/Update Profiles
        // Check if profile exists
        const profileRes = await client.query("SELECT * FROM public.profiles WHERE auth_user_id = $1", [userId]);

        if (profileRes.rowCount > 0) {
            console.log('Profile exists. Updating...');
            await client.query(`
                UPDATE public.profiles 
                SET department_id = $1, full_name = 'APSRTC Admin'
                WHERE auth_user_id = $2
            `, [deptId, userId]);
            console.log('✅ Profile updated linked to RTC Department.');
        } else {
            console.log('Profile does not exist. Inserting...');
            // We need to know required columns.
            // Assuming minimal: id, auth_user_id, department_id
            // If id is uuid default gen_random_uuid(), we can omit it.

            await client.query(`
                INSERT INTO public.profiles (auth_user_id, department_id, full_name)
                VALUES ($1, $2, 'APSRTC Admin')
            `, [userId, deptId]);
            console.log('✅ Profile created and linked to RTC Department.');
        }

        // 4. ALSO, for safety, should we make sure user_roles table has DEPARTMENT_ADMIN?
        const roleRes = await client.query("SELECT * FROM public.user_roles WHERE user_id = $1", [userId]);
        if (roleRes.rowCount === 0) {
            console.log('Inserting DEPARTMENT_ADMIN role into user_roles...');
            await client.query(`
                INSERT INTO public.user_roles (user_id, role)
                VALUES ($1, 'DEPARTMENT_ADMIN')
             `, [userId]);
        } else {
            console.log(`User has role: ${roleRes.rows[0].role}`);
            if (roleRes.rows[0].role !== 'DEPARTMENT_ADMIN') {
                console.log('Updating role to DEPARTMENT_ADMIN...');
                await client.query("UPDATE public.user_roles SET role = 'DEPARTMENT_ADMIN' WHERE user_id = $1", [userId]);
            }
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

linkRTCAdmin();
