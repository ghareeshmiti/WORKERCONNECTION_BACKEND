import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const isoBase64URL = {
  fromBuffer: (buffer) => {
    if (!buffer) return '';
    const base64 = Buffer.from(buffer).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  },
};

async function checkAuthenticators() {
  try {
    console.log('Checking authenticators for workers...\n');

    // First check the table schema
    console.log('Checking authenticators table schema...');
    const schemaRes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name='authenticators'
      ORDER BY ordinal_position
    `);
    
    console.log('Columns in authenticators table:');
    schemaRes.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

    const workerIds = ['WKR7378022984', 'WKR5671879717'];

    for (const workerId of workerIds) {
      console.log(`\n========== WORKER: ${workerId} ==========`);

      // Get all authenticators for this worker - get first row to test
      const res = await pool.query(
        `SELECT * FROM authenticators WHERE username = $1 LIMIT 5`,
        [workerId]
      );

      if (res.rowCount === 0) {
        console.log('❌ NO AUTHENTICATORS REGISTERED for this worker!');
        console.log('   → Worker needs to register a card first');
      } else {
        console.log(`✅ Found ${res.rowCount} authenticator(s):\n`);

        res.rows.forEach((row, idx) => {
          console.log(`  [${idx + 1}]`);
          Object.keys(row).forEach(key => {
            let val = row[key];
            if (Buffer.isBuffer(val)) {
              val = `(binary, ${val.length} bytes)`;
            }
            console.log(`      ${key}: ${val}`);
          });
        });
      }

      // Check worker record exists
      const workerRes = await pool.query(
        'SELECT worker_id FROM workers WHERE worker_id = $1',
        [workerId]
      );

      if (workerRes.rowCount > 0) {
        console.log(`\n✓ Worker record exists`);
      } else {
        console.log(`\n⚠ Worker record NOT found in workers table`);
      }
    }

    console.log('\n\n========== SUMMARY ==========');
    console.log('For fingerprint (biometric) authentication to work:');
    console.log('1. Worker must have at least 1 authenticator registered');
    console.log('2. Card must have biometric credentials enrolled');
    console.log('3. Transports should include "nfc"');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  }
}

checkAuthenticators();
