
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const CONDUCTOR_ID = '8dbd5680-84d8-4258-8ddc-4c3feea85cac';

async function seedConductorProfile() {
    try {
        console.log(`Seeding profile for Conductor ID: ${CONDUCTOR_ID}`);

        // 0. Ensure 'EMPLOYEE' role exists in enum
        try {
            // Must run outside transaction block usually, but here pool.query is fine
            await pool.query("ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'EMPLOYEE'");
            console.log("Added 'EMPLOYEE' to app_role enum.");
        } catch (e) {
            console.log("Could not add enum value (might already exist or use different command):", e.message);
        }

        // 1. Get an Establishment to link to (e.g. Guntur Depot)
        const resEst = await pool.query(`SELECT id, name, department_id FROM establishments LIMIT 1`);

        if (resEst.rows.length === 0) {
            console.log('No establishments found! Please run seed script first.');
            return;
        }

        const establishment = resEst.rows[0];
        console.log(`Linking to Establishment: ${establishment.name} (${establishment.id})`);

        // 2. Insert/Update Profile
        await pool.query(`
      INSERT INTO profiles (id, auth_user_id, full_name, establishment_id, department_id, created_at, updated_at)
      VALUES ($1, $1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE 
      SET establishment_id = $3, department_id = $4, updated_at = NOW();
    `, [CONDUCTOR_ID, 'Conductor Ravi', establishment.id, establishment.department_id]);

        // 3. Insert/Update User Role
        await pool.query(`
      INSERT INTO user_roles (user_id, role, created_at)
      VALUES ($1, 'EMPLOYEE', NOW())
      ON CONFLICT (user_id, role) DO NOTHING;
    `, [CONDUCTOR_ID]);

        console.log('Profile and Role seeded successfully.');

    } catch (err) {
        console.error('Seeding failed:', err);
    } finally {
        await pool.end();
    }
}

seedConductorProfile();
