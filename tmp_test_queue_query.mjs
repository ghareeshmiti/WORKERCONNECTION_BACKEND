import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  try {
    const docRes = await pool.query('SELECT id FROM doctors WHERE is_active = true LIMIT 1');
    if (docRes.rowCount === 0) {
      console.log('No active doctors found');
      return;
    }
    const doctorId = docRes.rows[0].id;
    console.log('Using doctorId', doctorId);

    const date = '2026-03-12';
    const query = `SELECT pq.*, fm.name AS patient_name, fm.relation,\n    CASE WHEN fm.relation = 'SELF' AND w.gender IS NOT NULL THEN w.gender ELSE fm.gender END AS gender,\n    COALESCE(fm.date_of_birth, CASE WHEN fm.relation = 'SELF' AND w.dob ~ '^\\\\d{4}-\\\\d{2}-\\\\d{2}$' THEN w.dob::date ELSE NULL END) AS date_of_birth\n    FROM patient_queue pq\n    JOIN family_members fm ON fm.id = pq.family_member_id\n    JOIN families f ON f.id = pq.family_id\n    LEFT JOIN workers w ON w.id = f.head_worker_id AND fm.relation = 'SELF'\n    WHERE pq.doctor_id = $1 AND DATE(pq.queued_at) = $2\n    ORDER BY pq.token_number ASC`;

    const res = await pool.query(query, [doctorId, date]);
    console.log('Query succeeded, rows:', res.rowCount);
  } catch (e) {
    console.error('Query error:', e);
  } finally {
    await pool.end();
  }
}

run();
