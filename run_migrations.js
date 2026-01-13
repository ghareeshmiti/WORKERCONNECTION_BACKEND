import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const MIGRATIONS_DIR = path.resolve(__dirname, '../client/supabase/migrations');

async function runMigrations() {
    const client = await pool.connect();
    try {
        console.log('Connected to database...');

        // Get list of migration files
        if (!fs.existsSync(MIGRATIONS_DIR)) {
            throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
        }

        const files = fs.readdirSync(MIGRATIONS_DIR)
            .filter(f => f.endsWith('.sql'))
            .sort(); // Ensure alphanumeric order

        console.log(`Found ${files.length} migration files.`);

        for (const file of files) {
            console.log(`Running migration: ${file}`);
            const filePath = path.join(MIGRATIONS_DIR, file);
            const sqlContent = fs.readFileSync(filePath, 'utf8');

            // Simple split by semicolon, crude but effective for this file structure
            // Remove comments to avoid false splits (optional but good)
            // We'll just split and trim.
            const statements = sqlContent
                .replace(/--.*$/gm, '') // Remove single line comments
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

            console.log(`  - Found ${statements.length} statements.`);

            for (const statement of statements) {
                try {
                    // Check if it's a transaction command, if so skip or handle?
                    // We just run it.
                    await client.query(statement);
                } catch (e) {
                    // Ignore "already exists" errors to allow idempotency
                    if (e.code === '42710' || e.code === '42P07' || e.message.includes('already exists')) {
                        console.log(`    - Skipped (Already exists): ${statement.substring(0, 30)}...`);
                    } else {
                        console.error(`    - FAILED: ${e.message}`);
                        console.error(`      Query: ${statement.substring(0, 100)}...`);
                        // Fail hard so we don't end up with partial state? 
                        // Or continue? Let's continue and see.
                    }
                }
            }
            console.log(`  - Completed file.`);
        }


        console.log('All migrations processed.');

    } catch (err) {
        console.error('Migration script error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigrations();
