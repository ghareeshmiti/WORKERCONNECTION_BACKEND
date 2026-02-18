
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function confirmEmails() {
    const client = await pool.connect();
    try {
        console.log('Attempting to confirm email addresses manually...');

        const emailsToConfirm = [
            'apsrtc@gmail.com',
            'gnt01@apsrtc.com',
            'kri01@apsrtc.com'
        ];

        // Update auth.users directly
        // Note: This requires the database user to have permissions on auth schema, 
        // which the standard connection string usually has in Supabase (postgres role).

        for (const email of emailsToConfirm) {
            const res = await client.query(`
                UPDATE auth.users 
                SET email_confirmed_at = NOW(), 
                    last_sign_in_at = NOW(),
                    raw_app_meta_data = raw_app_meta_data || '{"provider": "email", "providers": ["email"]}'::jsonb
                WHERE email = $1
                RETURNING id;
            `, [email]);

            if (res.rowCount > 0) {
                console.log(`✅ Confirmed email for: ${email}`);
            } else {
                console.log(`⚠️ User not found: ${email}`);
            }
        }

    } catch (err) {
        console.error('Error confirming emails:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

confirmEmails();
