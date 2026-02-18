
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const CONDUCTOR_ID = '8dbd5680-84d8-4258-8ddc-4c3feea85cac';

async function checkUserProfile() {
    try {
        console.log(`Checking profile for Conductor ID: ${CONDUCTOR_ID}`);

        // Check profiles table
        const resProfile = await pool.query(`
      SELECT * FROM profiles WHERE auth_user_id = $1 OR id = $1
    `, [CONDUCTOR_ID]);

        console.log('--- Profiles Table ---');
        if (resProfile.rows.length === 0) console.log('No profile found.');
        else console.log(resProfile.rows[0]);

        // Check user_roles table
        const resRole = await pool.query(`
      SELECT * FROM user_roles WHERE user_id = $1
    `, [CONDUCTOR_ID]);

        console.log('--- User Roles Table ---');
        if (resRole.rows.length === 0) console.log('No role found.');
        else console.log(resRole.rows[0]);

    } catch (err) {
        console.error('Check failed:', err);
    } finally {
        await pool.end();
    }
}

checkUserProfile();
