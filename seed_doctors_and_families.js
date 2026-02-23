import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey && supabaseServiceKey !== 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE' ? supabaseServiceKey : supabaseAnonKey);

async function getOrCreateUser(email, password, role) {
    // Sign out any existing session first to avoid interference
    await supabaseAdmin.auth.signOut().catch(() => {});

    // Try login first
    const { data: loginData, error: loginError } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (loginData?.user) {
        console.log(`  User ${email} exists (login OK). ID: ${loginData.user.id}`);
        // Sign out so next call gets a clean state
        await supabaseAdmin.auth.signOut().catch(() => {});
        return loginData.user.id;
    }
    if (loginError) {
        console.log(`  Login attempt for ${email}: ${loginError.message}`);
    }

    // Create user
    const { data: signUpData, error } = await supabaseAdmin.auth.signUp({
        email, password,
        options: { data: { role } }
    });
    if (error) {
        console.error(`  Failed to create ${email}:`, error.message);
        // If user exists but we can't login, try to find them via profiles table
        return null;
    }
    if (signUpData?.user) {
        console.log(`  Created user ${email}. ID: ${signUpData.user.id}`);
        await supabaseAdmin.auth.signOut().catch(() => {});
        return signUpData.user.id;
    }
    return null;
}

async function seedDoctorsAndFamilies() {
    const client = await pool.connect();
    try {
        console.log('=== Starting Doctor & Family Data Seeding ===\n');

        // 0. Add DOCTOR to app_role enum if not exists
        try {
            await client.query("ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'DOCTOR'");
            console.log("Added 'DOCTOR' to app_role enum (or already exists).");
        } catch (enumErr) {
            console.log('app_role enum note:', enumErr.message);
        }

        // 1. Get Guntur General Hospital ID
        const hospRes = await client.query(`SELECT id FROM establishments WHERE email = 'guntur.gh@aphealth.com' LIMIT 1`);
        if (hospRes.rowCount === 0) throw new Error('Guntur General Hospital not found! Run seed_health_data.js first.');
        const hospitalId = hospRes.rows[0].id;
        console.log('Hospital ID:', hospitalId);

        // 2. Get AP Health Department ID
        const deptRes = await client.query(`SELECT id FROM departments WHERE code = 'APHEALTH' LIMIT 1`);
        if (deptRes.rowCount === 0) throw new Error('AP Health department not found!');
        const deptId = deptRes.rows[0].id;

        // ========== SEED DOCTORS ==========
        console.log('\n--- Seeding Doctors ---');

        const doctorsList = [
            { email: 'dr.general@aphealth.com', name: 'Dr. Rajesh Kumar', specialization: 'General Medicine', qualification: 'MBBS, MD', experience: 12, phone: '9876543201' },
            { email: 'dr.cardio@aphealth.com', name: 'Dr. Priya Sharma', specialization: 'Cardiology', qualification: 'MBBS, DM Cardiology', experience: 15, phone: '9876543202' },
            { email: 'dr.neuro@aphealth.com', name: 'Dr. Suresh Reddy', specialization: 'Neurology', qualification: 'MBBS, DM Neurology', experience: 10, phone: '9876543203' },
            { email: 'dr.dental@aphealth.com', name: 'Dr. Anitha Rao', specialization: 'Dental', qualification: 'BDS, MDS', experience: 8, phone: '9876543204' },
            { email: 'dr.derma@aphealth.com', name: 'Dr. Venkat Naidu', specialization: 'Dermatology', qualification: 'MBBS, MD Dermatology', experience: 9, phone: '9876543205' },
            { email: 'dr.gynec@aphealth.com', name: 'Dr. Lakshmi Devi', specialization: 'Gynecology', qualification: 'MBBS, MS Gynecology', experience: 14, phone: '9876543206' },
        ];

        const password = 'Test@1234';

        for (const doc of doctorsList) {
            // Check if doctor already exists
            const existing = await client.query(`SELECT id FROM doctors WHERE email = $1`, [doc.email]);
            if (existing.rowCount > 0) {
                console.log(`  Doctor ${doc.name} already exists. Skipping.`);
                continue;
            }

            // Create Supabase auth user
            const authUserId = await getOrCreateUser(doc.email, password, 'DOCTOR');
            if (!authUserId) {
                console.error(`  Could not create auth user for ${doc.email}. Skipping.`);
                continue;
            }

            // Insert into user_roles table
            await client.query(`
                INSERT INTO user_roles (user_id, role)
                VALUES ($1, 'DOCTOR')
                ON CONFLICT (user_id, role) DO NOTHING
            `, [authUserId]);

            // Insert into profiles table
            await client.query(`
                INSERT INTO profiles (auth_user_id, full_name, establishment_id, department_id)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (auth_user_id) DO UPDATE SET full_name = $2, establishment_id = $3, department_id = $4
            `, [authUserId, doc.name, hospitalId, deptId]);

            // Insert into doctors table
            await client.query(`
                INSERT INTO doctors (auth_user_id, establishment_id, name, email, specialization, qualification, experience_years, phone)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [authUserId, hospitalId, doc.name, doc.email, doc.specialization, doc.qualification, doc.experience, doc.phone]);

            console.log(`  ✓ Doctor ${doc.name} (${doc.specialization}) created`);
        }

        // ========== SEED FAMILIES ==========
        console.log('\n--- Seeding Families ---');

        // Get workers to use as family heads
        const workersRes = await client.query(`
            SELECT id, worker_id, first_name, last_name, phone, district, card_uid
            FROM workers
            WHERE is_active = true
            ORDER BY created_at
            LIMIT 3
        `);

        if (workersRes.rowCount === 0) throw new Error('No active workers found! Need workers to create families.');
        console.log(`Found ${workersRes.rowCount} workers for family heads`);

        const familyData = [
            {
                // Family 1 - linked to first worker
                members: [
                    { relation: 'SELF', gender: 'Male', dob: '1985-03-15', blood_group: 'B+', allergies: 'None', chronic_conditions: 'Diabetes' },
                    { name: 'Lakshmi Devi', relation: 'SPOUSE', gender: 'Female', dob: '1988-07-22', blood_group: 'O+', allergies: 'Penicillin', chronic_conditions: 'None' },
                    { name: 'Ravi Kumar', relation: 'SON', gender: 'Male', dob: '2010-11-05', blood_group: 'B+', allergies: 'None', chronic_conditions: 'None' },
                    { name: 'Priya', relation: 'DAUGHTER', gender: 'Female', dob: '2013-04-18', blood_group: 'O+', allergies: 'Dust', chronic_conditions: 'Asthma' },
                ]
            },
            {
                // Family 2 - linked to second worker
                members: [
                    { relation: 'SELF', gender: 'Male', dob: '1980-06-10', blood_group: 'A+', allergies: 'Sulfa drugs', chronic_conditions: 'Hypertension' },
                    { name: 'Saraswathi', relation: 'SPOUSE', gender: 'Female', dob: '1983-12-01', blood_group: 'A-', allergies: 'None', chronic_conditions: 'Thyroid' },
                    { name: 'Karthik', relation: 'SON', gender: 'Male', dob: '2008-02-14', blood_group: 'A+', allergies: 'None', chronic_conditions: 'None' },
                    { name: 'Divya', relation: 'DAUGHTER', gender: 'Female', dob: '2012-09-30', blood_group: 'A+', allergies: 'Peanuts', chronic_conditions: 'None' },
                    { name: 'Ramaiah', relation: 'FATHER', gender: 'Male', dob: '1955-01-20', blood_group: 'O+', allergies: 'None', chronic_conditions: 'Diabetes, Arthritis' },
                ]
            },
            {
                // Family 3 - linked to third worker (if exists, else second)
                members: [
                    { relation: 'SELF', gender: 'Female', dob: '1990-08-25', blood_group: 'AB+', allergies: 'None', chronic_conditions: 'None' },
                    { name: 'Venkat Rao', relation: 'SPOUSE', gender: 'Male', dob: '1987-05-12', blood_group: 'B-', allergies: 'Aspirin', chronic_conditions: 'None' },
                    { name: 'Aditya', relation: 'SON', gender: 'Male', dob: '2015-03-08', blood_group: 'AB+', allergies: 'None', chronic_conditions: 'None' },
                ]
            }
        ];

        for (let i = 0; i < Math.min(familyData.length, workersRes.rowCount); i++) {
            const worker = workersRes.rows[i];
            const fData = familyData[i];

            // Check if family already exists for this worker
            const existingFamily = await client.query(`SELECT id FROM families WHERE head_worker_id = $1`, [worker.id]);
            if (existingFamily.rowCount > 0) {
                console.log(`  Family for ${worker.first_name} ${worker.last_name} already exists. Skipping.`);
                continue;
            }

            const familyName = `${worker.last_name || worker.first_name} Family`;

            // Create family
            const famResult = await client.query(`
                INSERT INTO families (head_worker_id, family_name, address, district, phone)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
            `, [worker.id, familyName, 'Guntur, Andhra Pradesh', worker.district || 'Guntur', worker.phone || '9876500000']);

            const familyId = famResult.rows[0].id;

            // Insert family members
            for (const member of fData.members) {
                const memberName = member.relation === 'SELF'
                    ? `${worker.first_name} ${worker.last_name || ''}`.trim()
                    : member.name;

                const memberPhone = member.relation === 'SELF' ? worker.phone : null;

                await client.query(`
                    INSERT INTO family_members (family_id, name, relation, gender, date_of_birth, blood_group, allergies, chronic_conditions, phone)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [familyId, memberName, member.relation, member.gender, member.dob, member.blood_group, member.allergies, member.chronic_conditions, memberPhone]);
            }

            console.log(`  ✓ Family "${familyName}" created with ${fData.members.length} members (head: ${worker.worker_id}, card_uid: ${worker.card_uid || 'N/A'})`);
        }

        // ========== SUMMARY ==========
        console.log('\n=== Seeding Completed Successfully! ===\n');
        console.log('Doctor Logins (all password: Test@1234):');
        for (const doc of doctorsList) {
            console.log(`  ${doc.email.padEnd(30)} → ${doc.name} (${doc.specialization})`);
        }

        const familyCount = await client.query(`SELECT COUNT(*) FROM families`);
        const memberCount = await client.query(`SELECT COUNT(*) FROM family_members`);
        const doctorCount = await client.query(`SELECT COUNT(*) FROM doctors`);
        console.log(`\nTotals: ${doctorCount.rows[0].count} doctors, ${familyCount.rows[0].count} families, ${memberCount.rows[0].count} family members`);

    } catch (err) {
        console.error('Seeding Error:', err.message);
        console.error(err.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

seedDoctorsAndFamilies();
