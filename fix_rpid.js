import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fixRpidIssue() {
  try {
    console.log('Fixing rpid issue in authenticators table...\n');

    const targetRpId = 'workerconnect.miti.us';

    // Find all authenticators with NULL rpid
    console.log('Finding authenticators with NULL rpid...');
    const nullRpidRes = await pool.query(
      `SELECT username, rpid FROM authenticators WHERE rpid IS NULL`
    );

    if (nullRpidRes.rowCount === 0) {
      console.log('✓ No authenticators with NULL rpid found');
      process.exit(0);
    }

    console.log(`\n Found ${nullRpidRes.rowCount} authenticator(s) with NULL rpid:\n`);
    nullRpidRes.rows.forEach((row, idx) => {
      console.log(`  [${idx + 1}] ${row.username}`);
    });

    // Update all NULL rpid records
    console.log(`\n⚠ Updating ${nullRpidRes.rowCount} record(s) to rpid = '${targetRpId}'...`);
    const updateRes = await pool.query(
      `UPDATE authenticators SET rpid = $1 WHERE rpid IS NULL`,
      [targetRpId]
    );

    console.log(`\n✅ Updated ${updateRes.rowCount} record(s)`);

    // Verify
    console.log('\nVerifying fix...');
    const verifyRes = await pool.query(
      `SELECT username, rpid FROM authenticators WHERE rpid IS NULL`
    );

    if (verifyRes.rowCount === 0) {
      console.log('✓ All rpid values are now set correctly!');
    } else {
      console.log(`⚠ Warning: Still found ${verifyRes.rowCount} records with NULL rpid`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

fixRpidIssue();
