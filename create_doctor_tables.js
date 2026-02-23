import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function createDoctorTables() {
    const client = await pool.connect();
    try {
        console.log('=== Creating Doctor & Family Tables ===\n');

        // 1. families table
        await client.query(`
            CREATE TABLE IF NOT EXISTS families (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                head_worker_id UUID UNIQUE REFERENCES workers(id),
                family_name TEXT,
                address TEXT,
                district TEXT,
                phone TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('✓ families table created');

        // 2. family_members table
        await client.query(`
            CREATE TABLE IF NOT EXISTS family_members (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                family_id UUID REFERENCES families(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                relation TEXT,
                gender TEXT,
                date_of_birth DATE,
                aadhaar_last_four TEXT,
                blood_group TEXT,
                allergies TEXT,
                chronic_conditions TEXT,
                phone TEXT,
                photo_url TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('✓ family_members table created');

        // 3. doctors table
        await client.query(`
            CREATE TABLE IF NOT EXISTS doctors (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                auth_user_id UUID UNIQUE,
                establishment_id UUID REFERENCES establishments(id),
                name TEXT NOT NULL,
                email TEXT UNIQUE,
                specialization TEXT,
                qualification TEXT,
                experience_years INTEGER,
                phone TEXT,
                photo_url TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('✓ doctors table created');

        // 4. patient_queue table
        await client.query(`
            CREATE TABLE IF NOT EXISTS patient_queue (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                doctor_id UUID REFERENCES doctors(id),
                family_member_id UUID REFERENCES family_members(id),
                family_id UUID REFERENCES families(id),
                establishment_id UUID REFERENCES establishments(id),
                token_number INTEGER,
                status TEXT DEFAULT 'WAITING',
                added_by UUID,
                notes TEXT,
                queued_at TIMESTAMPTZ DEFAULT NOW(),
                called_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ
            )
        `);
        console.log('✓ patient_queue table created');

        // Create index for fast queue lookups
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_patient_queue_doctor_date
            ON patient_queue (doctor_id, queued_at)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_patient_queue_status
            ON patient_queue (status)
        `);
        console.log('✓ patient_queue indexes created');

        // 5. e_prescriptions table
        await client.query(`
            CREATE TABLE IF NOT EXISTS e_prescriptions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                queue_id UUID REFERENCES patient_queue(id),
                doctor_id UUID REFERENCES doctors(id),
                family_member_id UUID REFERENCES family_members(id),
                establishment_id UUID REFERENCES establishments(id),
                diagnosis TEXT,
                symptoms TEXT,
                vitals JSONB,
                medicines JSONB,
                tests_recommended TEXT,
                advice TEXT,
                follow_up_date DATE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('✓ e_prescriptions table created');

        // Create index for prescription lookups
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_e_prescriptions_patient
            ON e_prescriptions (family_member_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_e_prescriptions_doctor
            ON e_prescriptions (doctor_id)
        `);
        console.log('✓ e_prescriptions indexes created');

        // Enable RLS on all new tables
        const tables = ['families', 'family_members', 'doctors', 'patient_queue', 'e_prescriptions'];
        for (const table of tables) {
            await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
            // Allow all operations for authenticated users (matching existing pattern)
            await client.query(`
                DO $$ BEGIN
                    CREATE POLICY "Allow all for authenticated" ON ${table}
                        FOR ALL USING (true) WITH CHECK (true);
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$
            `);
        }
        console.log('✓ RLS enabled on all tables');

        console.log('\n=== All Doctor & Family Tables Created Successfully! ===');

    } catch (err) {
        console.error('Error creating tables:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

createDoctorTables();
