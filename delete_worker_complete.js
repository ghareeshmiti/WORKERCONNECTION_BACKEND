
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function deleteWorker() {
    const workerPublicId = 'WKR00000001';
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        console.log(`Looking up UUID for ${workerPublicId}...`);

        // Get the internal UUID
        const resLookup = await client.query('SELECT id FROM workers WHERE worker_id = $1', [workerPublicId]);

        if (resLookup.rows.length === 0) {
            console.log('Worker not found in workers table. Trying to clean up potential orphans in other tables...');
            // Fallback: Delete just auth/users if worker profile is gone
            await client.query('DELETE FROM authenticators WHERE username = $1', [workerPublicId]);
            await client.query('DELETE FROM users WHERE username = $1', [workerPublicId]);
            await client.query('COMMIT');
            console.log('Cleaned up orphan auth/user records.');
            return;
        }

        const workerUUID = resLookup.rows[0].id;
        console.log(`Found Worker UUID: ${workerUUID}`);

        console.log(`Deleting data...`);

        // 1. Delete Authenticators (FIDO credentials) - Uses public ID (username)
        const resAuth = await client.query('DELETE FROM authenticators WHERE username = $1', [workerPublicId]);
        console.log(`Deleted ${resAuth.rowCount} authenticators.`);

        // 2. Delete Users (Login record) - Uses public ID (username)
        const resUser = await client.query('DELETE FROM users WHERE username = $1', [workerPublicId]);
        console.log(`Deleted ${resUser.rowCount} users.`);

        // 3. Delete Attendance Events - Uses UUID
        const resEvents = await client.query('DELETE FROM attendance_events WHERE worker_id = $1', [workerUUID]);
        console.log(`Deleted ${resEvents.rowCount} attendance events.`);

        // 4. Delete Worker Mappings - Uses UUID (checking column name assumption)
        // Note: Often mapping tables use UUIDs. If this fails, we check column.
        const resMap = await client.query('DELETE FROM worker_mappings WHERE worker_id = $1', [workerUUID]);
        console.log(`Deleted ${resMap.rowCount} worker mappings.`);

        // 5. Delete Worker Profile - Uses UUID
        const resWorker = await client.query('DELETE FROM workers WHERE id = $1', [workerUUID]);
        console.log(`Deleted ${resWorker.rowCount} worker profiles.`);

        await client.query('COMMIT');
        console.log('Successfully deleted all worker data.');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error deleting worker data:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

deleteWorker();
