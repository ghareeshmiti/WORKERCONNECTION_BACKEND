
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixRLS() {
    try {
        const queries = [
            // ESTABLISHMENTS
            `ALTER TABLE establishments ENABLE ROW LEVEL SECURITY`,
            `DROP POLICY IF EXISTS "Enable read access for all users" ON establishments`,
            `CREATE POLICY "Enable read access for all users" ON establishments FOR SELECT TO authenticated USING (true)`,

            // WORKER MAPPINGS
            `ALTER TABLE worker_mappings ENABLE ROW LEVEL SECURITY`,
            `DROP POLICY IF EXISTS "Enable read access for all users" ON worker_mappings`,
            `CREATE POLICY "Enable read access for all users" ON worker_mappings FOR SELECT TO authenticated USING (true)`,

            // WORKERS
            `ALTER TABLE workers ENABLE ROW LEVEL SECURITY`,
            `DROP POLICY IF EXISTS "Enable read access for all users" ON workers`,
            `CREATE POLICY "Enable read access for all users" ON workers FOR SELECT TO authenticated USING (true)`,

            // ATTENDANCE DAILY ROLLUPS
            `ALTER TABLE attendance_daily_rollups ENABLE ROW LEVEL SECURITY`,
            `DROP POLICY IF EXISTS "Enable read access for all users" ON attendance_daily_rollups`,
            `CREATE POLICY "Enable read access for all users" ON attendance_daily_rollups FOR SELECT TO authenticated USING (true)`,

            // ATTENDANCE EVENTS
            `ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY`,
            `DROP POLICY IF EXISTS "Enable read access for all users" ON attendance_events`,
            `CREATE POLICY "Enable read access for all users" ON attendance_events FOR SELECT TO authenticated USING (true)`,
        ];

        for (const q of queries) {
            console.log('Executing:', q);
            await pool.query(q);
        }
        console.log('RLS fixed successfully.');

    } catch (e) {
        console.error('Error fixing RLS:', e);
    } finally {
        await pool.end();
    }
}

fixRLS();
