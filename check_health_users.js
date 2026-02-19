import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const emails = ['aphealth@gmail.com', 'guntur.gh@aphealth.com', 'employ@aphealth.com'];

const authUsers = await pool.query(
    `SELECT id, email, email_confirmed_at, raw_app_meta_data FROM auth.users WHERE email = ANY($1)`,
    [emails]
);
console.log('\n=== Auth Users ===');
authUsers.rows.forEach(u => {
    console.log(`Email: ${u.email}`);
    console.log(`  ID: ${u.id}`);
    console.log(`  Confirmed: ${u.email_confirmed_at ? 'YES' : 'NO'}`);
    console.log(`  Role: ${JSON.stringify(u.raw_app_meta_data)}`);
});

const dept = await pool.query(`SELECT id, name, code, email FROM departments WHERE code='APHEALTH'`);
console.log('\n=== Department ===');
console.log(JSON.stringify(dept.rows, null, 2));

const hosp = await pool.query(`SELECT id, name, email FROM establishments WHERE email='guntur.gh@aphealth.com'`);
console.log('\n=== Hospital ===');
console.log(JSON.stringify(hosp.rows, null, 2));

// Check if IDs match
const deptAuthUser = authUsers.rows.find(u => u.email === 'aphealth@gmail.com');
const hospAuthUser = authUsers.rows.find(u => u.email === 'guntur.gh@aphealth.com');

if (deptAuthUser && dept.rows[0]) {
    const match = deptAuthUser.id === dept.rows[0].id;
    console.log(`\nDept ID match: ${match ? '✅ YES' : '❌ NO - MISMATCH!'}`);
    if (!match) {
        console.log(`  Auth user ID: ${deptAuthUser.id}`);
        console.log(`  Dept table ID: ${dept.rows[0].id}`);
        console.log('  → Need to update departments table with correct auth user ID');
    }
}

if (hospAuthUser && hosp.rows[0]) {
    const match = hospAuthUser.id === hosp.rows[0].id;
    console.log(`Hosp ID match: ${match ? '✅ YES' : '❌ NO - MISMATCH!'}`);
    if (!match) {
        console.log(`  Auth user ID: ${hospAuthUser.id}`);
        console.log(`  Establishment table ID: ${hosp.rows[0].id}`);
        console.log('  → Need to update establishments table with correct auth user ID');
    }
}

await pool.end();
