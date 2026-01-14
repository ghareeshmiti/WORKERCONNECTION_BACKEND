
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspect() {
    try {
        // Check if it's a view or table
        const res = await pool.query(`
            SELECT table_name, table_type 
            FROM information_schema.tables 
            WHERE table_name = 'attendance_daily_rollups'
        `);
        console.log('Table Type:', res.rows);

        // If it's a view, show definition
        if (res.rows.length > 0 && res.rows[0].table_type === 'VIEW') {
            const defRes = await pool.query(`
                SELECT definition 
                FROM pg_views 
                WHERE viewname = 'attendance_daily_rollups'
            `);
            console.log('View Definition:', defRes.rows[0]);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

inspect();
