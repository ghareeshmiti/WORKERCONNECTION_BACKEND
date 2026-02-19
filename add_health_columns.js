import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    const client = await pool.connect();
    try {
        console.log('Adding health columns to workers table...');

        // Add columns if they don't exist
        await client.query(`
      ALTER TABLE workers
        ADD COLUMN IF NOT EXISTS blood_group TEXT,
        ADD COLUMN IF NOT EXISTS allergies TEXT,
        ADD COLUMN IF NOT EXISTS chronic_conditions TEXT,
        ADD COLUMN IF NOT EXISTS scheme_name TEXT DEFAULT 'NTR Vaidya Seva',
        ADD COLUMN IF NOT EXISTS mandal TEXT,
        ADD COLUMN IF NOT EXISTS emergency_contact TEXT,
        ADD COLUMN IF NOT EXISTS emergency_phone TEXT
    `);
        console.log('Columns added successfully.');

        // Seed health data for WKR2445425056
        const w1 = await client.query(`SELECT id, worker_id, first_name FROM workers WHERE worker_id = 'WKR2445425056' LIMIT 1`);
        if (w1.rowCount > 0) {
            const w = w1.rows[0];
            await client.query(`
        UPDATE workers SET
          blood_group = 'B+',
          allergies = 'Penicillin, Dust',
          chronic_conditions = 'Diabetes Type 2, Hypertension',
          scheme_name = 'NTR Vaidya Seva',
          mandal = 'Guntur Urban',
          emergency_contact = 'Ravi Kumar',
          emergency_phone = '9876543210'
        WHERE id = $1
      `, [w.id]);
            console.log(`Updated health data for ${w.first_name} (${w.worker_id})`);
        } else {
            console.log('WKR2445425056 not found');
        }

        // Seed health data for WKR3169542398
        const w2 = await client.query(`SELECT id, worker_id, first_name FROM workers WHERE worker_id = 'WKR3169542398' LIMIT 1`);
        if (w2.rowCount > 0) {
            const w = w2.rows[0];
            await client.query(`
        UPDATE workers SET
          blood_group = 'O+',
          allergies = 'Sulfa drugs',
          chronic_conditions = 'Asthma',
          scheme_name = 'EHS',
          mandal = 'Tenali',
          emergency_contact = 'Lakshmi Devi',
          emergency_phone = '9988776655'
        WHERE id = $1
      `, [w.id]);
            console.log(`Updated health data for ${w.first_name} (${w.worker_id})`);
        } else {
            console.log('WKR3169542398 not found');
        }

        // Also update a few more random workers with health data for demo
        const others = await client.query(`
      SELECT id, worker_id, first_name FROM workers
      WHERE worker_id NOT IN ('WKR2445425056', 'WKR3169542398')
      AND blood_group IS NULL
      LIMIT 20
    `);

        const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
        const allergiesList = ['None', 'Penicillin', 'Aspirin', 'Dust, Pollen', 'Sulfa drugs', 'Latex', 'None', 'Ibuprofen'];
        const conditions = ['None', 'Diabetes Type 2', 'Hypertension', 'Asthma', 'Thyroid', 'Arthritis', 'None', 'Anemia', 'None', 'Diabetes Type 2'];
        const schemes = ['NTR Vaidya Seva', 'EHS', 'PMJAY', 'NTR Vaidya Seva', 'NTR Vaidya Seva', 'EHS', 'PMJAY', 'NTR Vaidya Seva'];
        const mandals = ['Guntur Urban', 'Tenali', 'Mangalagiri', 'Bapatla', 'Narasaraopet', 'Ponnur', 'Repalle', 'Sattenapalle'];

        for (let i = 0; i < others.rows.length; i++) {
            const w = others.rows[i];
            await client.query(`
        UPDATE workers SET
          blood_group = $1,
          allergies = $2,
          chronic_conditions = $3,
          scheme_name = $4,
          mandal = $5
        WHERE id = $6
      `, [
                bloodGroups[i % bloodGroups.length],
                allergiesList[i % allergiesList.length],
                conditions[i % conditions.length],
                schemes[i % schemes.length],
                mandals[i % mandals.length],
                w.id
            ]);
        }
        console.log(`Updated health data for ${others.rowCount} additional workers.`);

        console.log('\n✅ Health columns migration complete!');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
