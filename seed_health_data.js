import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Use service role if available, else anon
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey && supabaseServiceKey !== 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE' ? supabaseServiceKey : supabaseAnonKey);

async function getOrCreateUser(email, password, role) {
    // Try login first
    const { data: loginData } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (loginData?.user) {
        console.log(`User ${email} exists. ID: ${loginData.user.id}`);
        return loginData.user.id;
    }
    // Create user
    const { data: signUpData, error } = await supabaseAdmin.auth.signUp({
        email, password,
        options: { data: { role } }
    });
    if (error) { console.error(`Failed to create ${email}:`, error.message); return null; }
    console.log(`Created user ${email}. ID: ${signUpData.user.id}`);
    return signUpData.user.id;
}

async function seedHealthData() {
    const client = await pool.connect();
    try {
        console.log('=== Starting AP Health Data Seeding ===');

        // 1. Get/Create AP Health Department
        const deptEmail = 'aphealth@gmail.com';
        const deptPassword = 'Test@1234';

        let deptId;
        const deptCheck = await client.query(`SELECT id FROM departments WHERE code = 'APHEALTH' OR email = $1 LIMIT 1`, [deptEmail]);
        if (deptCheck.rowCount > 0) {
            deptId = deptCheck.rows[0].id;
            console.log('AP Health Department found. ID:', deptId);
        } else {
            const deptUserId = await getOrCreateUser(deptEmail, deptPassword, 'department');
            if (!deptUserId) throw new Error('Could not create AP Health dept user');

            await client.query(`
        INSERT INTO departments (id, name, code, state, district, mandal, pincode, address_line, phone, email, is_active, created_at, updated_at)
        VALUES ($1, 'AP Health & Family Welfare Department', 'APHEALTH', 'Andhra Pradesh', 'Amaravati', 'Amaravati Urban', '522020', 'Health Bhavan, Amaravati', '0863-2340001', $2, true, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `, [deptUserId, deptEmail]);
            deptId = deptUserId;
            console.log('AP Health Department created. ID:', deptId);
        }

        // 2. Get/Create Guntur General Hospital (Establishment)
        const hospitalEmail = 'guntur.gh@aphealth.com';
        const hospitalPassword = 'Test@1234';

        let hospitalId;
        const hospCheck = await client.query(`SELECT id FROM establishments WHERE email = $1 LIMIT 1`, [hospitalEmail]);
        if (hospCheck.rowCount > 0) {
            hospitalId = hospCheck.rows[0].id;
            console.log('Guntur GH found. ID:', hospitalId);
        } else {
            const hospUserId = await getOrCreateUser(hospitalEmail, hospitalPassword, 'establishment');
            if (!hospUserId) throw new Error('Could not create hospital user');

            await client.query(`
        INSERT INTO establishments (id, department_id, name, code, establishment_type, state, district, mandal, pincode, address_line, phone, email, is_active, is_approved, created_at, updated_at)
        VALUES ($1, $2, 'Guntur General Hospital', 'GGH001', 'Hospital', 'Andhra Pradesh', 'Guntur', 'Guntur Urban', '522001', 'Collector Office Road, Guntur', '0863-2222222', $3, true, true, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `, [hospUserId, deptId, hospitalEmail]);
            hospitalId = hospUserId;
            console.log('Guntur GH created. ID:', hospitalId);
        }

        // 3. Get/Create Employee (Operator)
        const empEmail = 'employ@aphealth.com';
        const empPassword = 'Test@1234';
        let operatorId;
        const empCheck = await client.query(`SELECT id FROM employees WHERE email = $1 LIMIT 1`, [empEmail]).catch(() => ({ rowCount: 0 }));
        if (empCheck.rowCount > 0) {
            operatorId = empCheck.rows[0].id;
        } else {
            operatorId = await getOrCreateUser(empEmail, empPassword, 'employee');
            console.log('Employee user created. ID:', operatorId);
        }

        // 4. Get the two workers
        const workersRes = await client.query(`
      SELECT id, worker_id, first_name, last_name FROM workers
      WHERE worker_id IN ('WKR2445425056', 'WKR3169542398')
    `);
        if (workersRes.rowCount === 0) throw new Error('Workers WKR2445425056 and WKR3169542398 not found!');
        console.log(`Found ${workersRes.rowCount} workers:`, workersRes.rows.map(w => `${w.worker_id} (${w.first_name} ${w.last_name})`).join(', '));

        const workers = workersRes.rows;

        // 5. Seed hospital_records
        const services = [
            { service_type: 'Consultation', diagnosis: 'Diabetes', description: 'Diabetes follow-up consultation', cost: 500, scheme: 'NTR Vaidya Seva', govt_paid: 500 },
            { service_type: 'Pharmacy', diagnosis: 'Diabetes', description: 'Monthly diabetes medicines', cost: 1200, scheme: 'NTR Vaidya Seva', govt_paid: 1200 },
            { service_type: 'Laboratory', diagnosis: 'Diabetes', description: 'HbA1c and blood sugar panel', cost: 800, scheme: 'NTR Vaidya Seva', govt_paid: 800 },
            { service_type: 'Consultation', diagnosis: 'Hypertension', description: 'BP management consultation', cost: 500, scheme: 'EHS', govt_paid: 500 },
            { service_type: 'Pharmacy', diagnosis: 'Hypertension', description: 'Antihypertensive medicines', cost: 900, scheme: 'EHS', govt_paid: 900 },
            { service_type: 'Surgery', diagnosis: 'Eye Disease', description: 'Cataract surgery - left eye', cost: 35000, scheme: 'NTR Vaidya Seva', govt_paid: 35000 },
            { service_type: 'Laboratory', diagnosis: 'Diabetes', description: 'Fasting blood sugar test', cost: 600, scheme: 'PMJAY', govt_paid: 600 },
            { service_type: 'Consultation', diagnosis: 'Fever', description: 'General fever consultation', cost: 300, scheme: 'Paid', govt_paid: 0 },
            { service_type: 'Laboratory', diagnosis: 'Fever', description: 'CBC and malaria test', cost: 700, scheme: 'Paid', govt_paid: 0 },
            { service_type: 'Pharmacy', diagnosis: 'Fever', description: 'Antipyretics and antibiotics', cost: 450, scheme: 'Paid', govt_paid: 0 },
        ];

        // Check existing records count
        const existingCount = await client.query(`SELECT COUNT(*) FROM hospital_records WHERE establishment_id = $1`, [hospitalId]);
        if (parseInt(existingCount.rows[0].count) > 20) {
            console.log('Health records already seeded. Skipping...');
        } else {
            let recordCount = 0;
            for (const worker of workers) {
                for (let i = 0; i < services.length; i++) {
                    const svc = services[i];
                    // Spread over last 30 days
                    const date = new Date();
                    date.setDate(date.getDate() - Math.floor(Math.random() * 30));

                    await client.query(`
            INSERT INTO hospital_records (worker_id, establishment_id, operator_id, service_type, scheme_name, diagnosis, description, cost, govt_paid, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `, [worker.id, hospitalId, operatorId, svc.service_type, svc.scheme, svc.diagnosis, svc.description, svc.cost, svc.govt_paid, date.toISOString()]);
                    recordCount++;
                }
            }
            console.log(`Inserted ${recordCount} hospital records.`);
        }

        // 6. Seed health_appointments
        const apptCheck = await client.query(`SELECT COUNT(*) FROM health_appointments WHERE establishment_id = $1`, [hospitalId]);
        if (parseInt(apptCheck.rows[0].count) > 5) {
            console.log('Appointments already seeded. Skipping...');
        } else {
            const appointments = [
                { doctor: 'Dr. Kavitha', dept: 'Ophthalmology', days: 5, notes: 'Cataract assessment' },
                { doctor: 'Dr. Mohan', dept: 'Endocrinology', days: 12, notes: 'Follow-up for diabetes management' },
                { doctor: 'Dr. Ravi', dept: 'Cardiology', days: 20, notes: 'BP monitoring and ECG' },
            ];
            for (const worker of workers) {
                for (const appt of appointments) {
                    const apptDate = new Date();
                    apptDate.setDate(apptDate.getDate() + appt.days);
                    await client.query(`
            INSERT INTO health_appointments (worker_id, establishment_id, doctor_name, department, appointment_date, status, notes)
            VALUES ($1, $2, $3, $4, $5, 'Scheduled', $6)
          `, [worker.id, hospitalId, appt.doctor, appt.dept, apptDate.toISOString().split('T')[0], appt.notes]);
                }
            }
            console.log(`Inserted appointments for ${workers.length} workers.`);
        }

        // 7. Seed health_checkups
        const checkupCheck = await client.query(`SELECT COUNT(*) FROM health_checkups WHERE establishment_id = $1`, [hospitalId]);
        if (parseInt(checkupCheck.rows[0].count) > 5) {
            console.log('Checkups already seeded. Skipping...');
        } else {
            const checkups = [
                {
                    type: 'General Checkup', doctor: 'Dr. Mohan',
                    findings: 'Blood sugar elevated, BP controlled',
                    vitals: { bp: '130/85', pulse: 78, temp: '98.4F', weight: '62kg' },
                    prescriptions: 'Metformin 500mg, Amlodipine 5mg',
                    daysAgo: 65
                },
                {
                    type: 'Eye Checkup', doctor: 'Dr. Kavitha',
                    findings: 'Early cataract detected in left eye',
                    vitals: { bp: '140/90', pulse: 82, temp: '98.6F', weight: '63kg' },
                    prescriptions: 'Eye drops - Moxifloxacin',
                    daysAgo: 140
                },
            ];
            for (const worker of workers) {
                for (const chk of checkups) {
                    const chkDate = new Date();
                    chkDate.setDate(chkDate.getDate() - chk.daysAgo);
                    await client.query(`
            INSERT INTO health_checkups (worker_id, establishment_id, checkup_type, doctor_name, findings, vitals, prescriptions, checkup_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [worker.id, hospitalId, chk.type, chk.doctor, chk.findings, JSON.stringify(chk.vitals), chk.prescriptions, chkDate.toISOString().split('T')[0]]);
                }
            }
            console.log(`Inserted checkups for ${workers.length} workers.`);
        }

        console.log('\n=== AP Health Seeding Completed Successfully! ===');
        console.log(`Department: ${deptEmail} / Test@1234`);
        console.log(`Hospital:   ${hospitalEmail} / Test@1234`);
        console.log(`Employee:   ${empEmail} / Test@1234`);

    } catch (err) {
        console.error('Seeding Error:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

seedHealthData();
