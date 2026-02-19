import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function createHealthTables() {
    const client = await pool.connect();
    try {
        console.log('Creating health tables...');

        // Create hospital_records table
        await client.query(`
      CREATE TABLE IF NOT EXISTS hospital_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
        establishment_id UUID REFERENCES establishments(id) ON DELETE SET NULL,
        operator_id UUID,
        service_type TEXT NOT NULL,
        scheme_name TEXT NOT NULL DEFAULT 'Paid',
        diagnosis TEXT,
        description TEXT,
        cost NUMERIC NOT NULL DEFAULT 0,
        govt_paid NUMERIC NOT NULL DEFAULT 0,
        patient_paid NUMERIC GENERATED ALWAYS AS (cost - govt_paid) STORED,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
        console.log('hospital_records table created.');

        // Create health_appointments table
        await client.query(`
      CREATE TABLE IF NOT EXISTS health_appointments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
        establishment_id UUID REFERENCES establishments(id) ON DELETE SET NULL,
        doctor_name TEXT,
        department TEXT,
        appointment_date DATE,
        status TEXT DEFAULT 'Scheduled',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
        console.log('health_appointments table created.');

        // Create health_checkups table
        await client.query(`
      CREATE TABLE IF NOT EXISTS health_checkups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
        establishment_id UUID REFERENCES establishments(id) ON DELETE SET NULL,
        checkup_type TEXT,
        doctor_name TEXT,
        findings TEXT,
        vitals JSONB,
        prescriptions TEXT,
        checkup_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
        console.log('health_checkups table created.');

        // Indexes
        await client.query(`CREATE INDEX IF NOT EXISTS idx_hospital_records_worker ON hospital_records(worker_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_hospital_records_est ON hospital_records(establishment_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_hospital_records_created ON hospital_records(created_at);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_health_appts_worker ON health_appointments(worker_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_health_checkups_worker ON health_checkups(worker_id);`);

        console.log('All health tables and indexes created successfully!');
    } catch (err) {
        console.error('Migration error:', err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

createHealthTables();
