
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const EMAIL = "vijayawada.welfare@gmail.com";
const PASSWORD = "Test@1234";

async function testLogin() {
    try {
        console.log(`Testing manual login for ${EMAIL}...`);

        const res = await pool.query(`
            SELECT id, email, encrypted_password 
            FROM auth.users 
            WHERE email = $1
        `, [EMAIL]);

        if (res.rows.length === 0) {
            console.error('User NOT FOUND in auth.users');
            return;
        }

        const user = res.rows[0];
        console.log('User Found. ID:', user.id);
        console.log('Encrypted Pwd:', user.encrypted_password);

        // Verify password
        const validRes = await pool.query(`
            SELECT (encrypted_password = crypt($1, encrypted_password)) AS is_valid
            FROM auth.users
            WHERE id = $2
        `, [PASSWORD, user.id]);

        const isValid = validRes.rows[0].is_valid;
        console.log('Password Valid?', isValid);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

testLogin();
