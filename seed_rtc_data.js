
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const { Pool } = pg;

const supabaseUrl = process.env.SUPABASE_URL || 'https://seecqtxhpsostjniabeo.supabase.co';
// Use Anon Key as Admin Key is missing
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function getOrCreateUser(email, password, role) {
    // 1. Try Login
    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });

    if (loginData?.user) {
        console.log(`User ${email} found (Logged in). ID: ${loginData.user.id}`);
        return loginData.user.id;
    }

    // 2. Try SignUp
    console.log(`User not found or password mismatch. Attempting creation for ${email}...`);
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { role: role === 'department' ? 'department' : 'establishment' }
        }
    });

    if (signUpData?.user) {
        // Check if user is actually created or if it requires email confirmation 
        // (Supabase returns a user object even if confirmation is needed)
        console.log(`User ${email} created. ID: ${signUpData.user.id}`);
        return signUpData.user.id;
    }

    if (signUpError) {
        console.error(`Failed to create/login ${email}:`, signUpError.message);
        return null;
    }

    return null;
}

async function seedRTCData() {
    const client = await pool.connect();

    try {
        console.log('Starting RTC Seeding (Client-side Auth Mode)...');

        // 1. Get/Create APSRTC Department User
        const deptEmail = 'apsrtc@gmail.com';
        const deptPassword = 'Test@1234';

        // 2. Insert into public.departments if not exists
        // First, check if RTC department exists by CODE to avoid unique constraint error
        const rtcCheck = await client.query("SELECT * FROM departments WHERE code = 'RTC'");
        let deptUserId;

        if (rtcCheck.rowCount > 0) {
            console.log("APSRTC Department found by code 'RTC'. Using existing ID.");
            deptUserId = rtcCheck.rows[0].id;
        } else {
            // Only create new USER if department doesn't exist (or we could separate them, but let's assume if dept missing, user missing)
            deptUserId = await getOrCreateUser(deptEmail, deptPassword, 'department');

            if (!deptUserId) {
                throw new Error("Could not retrieve or create APSRTC user.");
            }

            const deptCheck = await client.query('SELECT * FROM departments WHERE id = $1', [deptUserId]);
            if (deptCheck.rowCount === 0) {
                console.log('Inserting into departments table...');
                await client.query(`
                INSERT INTO departments (
                  id, name, code, state, district, mandal, pincode, address_line, phone, email, is_active, created_at, updated_at
                ) VALUES ($1, $2, $3, 'Andhra Pradesh', 'Vijayawada', 'Vijayawada Urban', '520001', 'RTC House', '9999999999', $4, true, NOW(), NOW())
              `, [deptUserId, 'Andhra Pradesh State Road Transport Corporation', 'RTC', deptEmail]);
            }
        }

        // 3. Create Establishments (Depots)
        const depots = [
            { name: 'Guntur Main Depot', district: 'Guntur', code: 'GNT01' },
            { name: 'Guntur Rural Depot', district: 'Guntur', code: 'GNT02' },
            { name: 'Tenali Depot', district: 'Guntur', code: 'TNL01' },
            { name: 'Vijayawada Main Depot', district: 'Krishna', code: 'VJA01' },
            { name: 'Machilipatnam Depot', district: 'Krishna', code: 'MTM01' },
            { name: 'Nuzvid Depot', district: 'Krishna', code: 'NZD01' }
        ];

        const depotIds = {};

        for (const depot of depots) {
            const estEmail = `${depot.code.toLowerCase()}@apsrtc.com`;
            const estPassword = 'Test@1234';

            const estUserId = await getOrCreateUser(estEmail, estPassword, 'establishment');

            if (!estUserId) {
                console.error(`Skipping establishment ${depot.name} due to auth failure.`);
                continue;
            }

            // Check/Insert into establishments
            const estCheck = await client.query('SELECT * FROM establishments WHERE id = $1', [estUserId]);
            if (estCheck.rowCount === 0) {
                console.log(`Inserting establishment ${depot.name}...`);
                await client.query(`
          INSERT INTO establishments (
            id, department_id, name, code, establishment_type, state, district, mandal, pincode, address_line, phone, email, is_active, is_approved, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'Depot', 'Andhra Pradesh', $5, 'Mandal', '500000', 'Depot Address', '8888888888', $6, true, true, NOW(), NOW())
        `, [estUserId, deptUserId, depot.name, depot.code, depot.district, estEmail]);
            } else {
                console.log(`Establishment ${depot.name} exists.`);
            }
            depotIds[depot.code] = estUserId;
        }

        // 4. Seed Tickets (Sample Data)
        console.log('Seeding Sample Tickets...');

        // Get a valid worker ID
        let workerId;
        const workerRes = await client.query('SELECT id FROM workers LIMIT 1');
        if (workerRes.rowCount > 0) {
            workerId = workerRes.rows[0].id;
            console.log(`Using existing worker ID: ${workerId}`);
        } else {
            console.log('No workers found. Creating dummy worker...');

            const firstDepotId = Object.values(depotIds)[0];

            const newWorker = await client.query(`
                INSERT INTO workers (
                    name, father_name, dob, gender, mobile_number, aadhaar_number, department_id, establishment_id, verification_status, created_at, updated_at
                ) VALUES (
                    'Dummy Passenger', 'Father', '1990-01-01', 'Male', '9999999999', '123412341234', $1, $2, 'Verified', NOW(), NOW()
                ) RETURNING id
            `, [deptUserId, firstDepotId]);
            workerId = newWorker.rows[0].id;
            console.log(`Created new worker ID: ${workerId}`);
        }

        const routes = [
            { id: 'R001', name: 'Guntur - Vijayawada', fare: 95 },
            { id: 'R002', name: 'Tenali - Guntur', fare: 45 },
            { id: 'R003', name: 'Guntur - Narasaraopet', fare: 60 }
        ];

        const schemes = ['Paid', 'Free (Women)', 'Student Pass', 'Employee Concession', 'Old Age', 'Govt Scheme'];

        // Only seed if existing tickets are low (to avoid duplicates on re-run)
        const ticketCountRes = await client.query('SELECT count(*) FROM tickets');
        if (parseInt(ticketCountRes.rows[0].count) < 20) {
            for (let i = 0; i < 50; i++) {
                // Randomly select depot, route, scheme
                const depotCode = Object.keys(depotIds)[Math.floor(Math.random() * Object.keys(depotIds).length)];
                const estId = depotIds[depotCode];
                const route = routes[Math.floor(Math.random() * routes.length)];
                const scheme = schemes[Math.floor(Math.random() * schemes.length)];

                const isFree = scheme !== 'Paid';
                const fare = isFree ? 0 : route.fare;
                const subsidy = isFree ? route.fare : 0;
                const remarks = isFree ? scheme : null;

                // Random date within last 7 days
                const date = new Date();
                date.setDate(date.getDate() - Math.floor(Math.random() * 7));

                await client.query(`
                    INSERT INTO tickets (
                        worker_id, establishment_id, bus_number, route_id, route_name, from_stop, to_stop, fare, is_free, govt_subsidy_amount, remarks, issued_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
                    )
                 `, [
                    workerId,
                    estId,
                    'AP 16 Z 1234',
                    route.id,
                    route.name,
                    route.name.split(' - ')[0],
                    route.name.split(' - ')[1],
                    fare,
                    isFree,
                    subsidy,
                    remarks,
                    date.toISOString()
                ]);
            }
            console.log('Inserted 50 sample tickets.');
        } else {
            console.log('Tickets already exist. Skipping ticket seeding.');
        }


        console.log('RTC Seeding Completed Successfully.');

    } catch (err) {
        console.error('Seeding Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

seedRTCData();
