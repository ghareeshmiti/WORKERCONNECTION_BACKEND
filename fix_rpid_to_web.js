import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fixRpidToWebDomain() {
  try {
    console.log('Updating authenticators rpid to match web domain...\n');

    const webRpId = 'workerconnection-frontend-git-328ded-hareeshs-projects-c2dba439.vercel.app';
    const workersToUpdate = ['WKR7378022984', 'WKR5671879717'];

    for (const worker of workersToUpdate) {
      console.log(`Updating ${worker}...`);
      
      const res = await pool.query(
        `UPDATE authenticators SET rpid = $1 WHERE username = $2`,
        [webRpId, worker]
      );

      if (res.rowCount > 0) {
        console.log(`  ✅ Updated ${res.rowCount} authenticator(s) for ${worker}`);
      } else {
        console.log(`  ⚠ No authenticators found for ${worker}`);
      }
    }

    // Verify
    console.log('\n✓ Verification:');
    for (const worker of workersToUpdate) {
      const res = await pool.query(
        `SELECT rpid FROM authenticators WHERE username = $1`,
        [worker]
      );
      
      if (res.rowCount > 0) {
        console.log(`  ${worker}: rpid = ${res.rows[0].rpid}`);
      }
    }

    // Show all rpIds that mobile app will try
    console.log('\nRpIDs that mobile app will try for authentication:');
    const rpIdRes = await pool.query(`SELECT DISTINCT rpid FROM authenticators WHERE rpid IS NOT NULL ORDER BY rpid`);
    rpIdRes.rows.forEach((row, idx) => {
      console.log(`  [${idx + 1}] ${row.rpid}`);
    });

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

fixRpidToWebDomain();
