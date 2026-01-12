
import Database from 'better-sqlite3';
import fs from 'fs';

const dbPath = 'fido.db';
if (!fs.existsSync(dbPath)) {
    console.error('Database file not found at:', dbPath);
    process.exit(1);
}

const db = new Database(dbPath, { verbose: console.log });

console.log('--- Tables ---');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.table(tables);

if (tables.length === 0) {
    console.log('No tables found.');
}

for (const table of tables) {
    console.log(`\n--- Schema for ${table.name} ---`);
    const prisma = db.prepare(`PRAGMA table_info(${table.name})`).all();
    console.table(prisma);

    const count = db.prepare(`SELECT count(*) as count FROM ${table.name}`).get();
    console.log(`Row count: ${count.count}`);
}
