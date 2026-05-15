import pg from 'pg';
import 'dotenv/config';

// This script creates a "Gangineni" family (head worker + family members).
// Usage: node server/seed_gangineni_family.js

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const workerIdOrCard = process.argv[2] || 'WKR8362514241';

  console.log(`Looking up worker for identifier: ${workerIdOrCard}`);

  const workerRes = await pool.query(
    `SELECT id, worker_id, first_name, last_name, phone, district, card_uid, gender, dob
     FROM workers
     WHERE (UPPER(worker_id) = $1 OR UPPER(card_uid) = $1) AND is_active = true
     LIMIT 1`,
    [workerIdOrCard.toUpperCase()]
  );

  if (workerRes.rowCount === 0) {
    console.error(`No active worker found for '${workerIdOrCard}'.`);
    process.exit(1);
  }

  const worker = workerRes.rows[0];
  console.log(`Found worker: ${worker.worker_id} (${worker.first_name} ${worker.last_name || ''})`);

  const familyRes = await pool.query(
    `SELECT id FROM families WHERE head_worker_id = $1 LIMIT 1`,
    [worker.id]
  );
  if (familyRes.rowCount > 0) {
    console.log('Family already exists for this worker (id:', familyRes.rows[0].id, '). Skipping create.');
    process.exit(0);
  }

  const familyName = `${worker.first_name} ${worker.last_name || ''}`.trim() + ' Family';
  const insertFamily = await pool.query(
    `INSERT INTO families (head_worker_id, family_name, address, district, phone)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [worker.id, familyName, 'Guntur, Andhra Pradesh', worker.district || 'Guntur', worker.phone || '']
  );

  const familyId = insertFamily.rows[0].id;
  console.log('Created family with id:', familyId);

  const memberName = `${worker.first_name} ${worker.last_name || ''}`.trim();
  await pool.query(
    `INSERT INTO family_members (family_id, name, relation, gender, date_of_birth, blood_group, allergies, chronic_conditions, phone, is_active)
     VALUES ($1, $2, 'SELF', $3, $4, $5, $6, $7, $8, true)`,
    [familyId, memberName, worker.gender, worker.dob, null, null, null, worker.phone || null]
  );

  console.log('Created SELF member for head worker.');

  // Add an example spouse and child (optional)
  await pool.query(
    `INSERT INTO family_members (family_id, name, relation, gender, date_of_birth, is_active)
     VALUES
       ($1, $2, 'SPOUSE', 'Female', '1990-01-01', true),
       ($1, $3, 'SON', 'Male', '2010-01-01', true)`,
    [familyId, 'Sarla Gangineni', 'Krishna Gangineni']
  );

  console.log('Created example SPOUSE and SON members.');
  console.log('Done.');
  process.exit(0);
}

run().catch((err) => {
  console.error('Error running seed script:', err);
  process.exit(1);
});
