
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixRLS() {
    try {
        console.log('Relaxing RLS on public.workers...');

        await pool.query(`
            -- INSERT
            DROP POLICY IF EXISTS "Enable insert for authenticated users" ON "public"."workers";
            CREATE POLICY "Enable insert for authenticated users"
            ON "public"."workers"
            FOR INSERT
            TO authenticated
            WITH CHECK (true);

            -- SELECT (Allow everything for now to prevent 404s/empty lists)
            DROP POLICY IF EXISTS "Enable select for authenticated users" ON "public"."workers";
            CREATE POLICY "Enable select for authenticated users"
            ON "public"."workers"
            FOR SELECT
            TO authenticated
            USING (true);

            -- UPDATE
            DROP POLICY IF EXISTS "Enable update for authenticated users" ON "public"."workers";
            CREATE POLICY "Enable update for authenticated users"
            ON "public"."workers"
            FOR UPDATE
            TO authenticated
            USING (true);

            -- AUTHENTICATORS (Crucial for FIDO Registration)
            DROP POLICY IF EXISTS "Enable all for authenticated users" ON "public"."authenticators";
            CREATE POLICY "Enable all for authenticated users"
            ON "public"."authenticators"
            FOR ALL
            TO authenticated
            USING (true)
            WITH CHECK (true);

            -- WORKER_MAPPINGS (For assigning to establishments)
            DROP POLICY IF EXISTS "Enable all for authenticated users" ON "public"."worker_mappings";
            CREATE POLICY "Enable all for authenticated users"
            ON "public"."worker_mappings"
            FOR ALL
            TO authenticated
            USING (true)
            WITH CHECK (true);
        `);

        console.log('RLS Policies Updated Successfully.');

    } catch (e) {
        console.error('Error updating RLS:', e);
    } finally {
        await pool.end();
    }
}

fixRLS();
