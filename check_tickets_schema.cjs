
require('dotenv').config({ path: './server/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSchema() {
    console.log("Checking tickets table columns...");

    // Check if tickets table exists and get columns by selecting keys
    const { data, error } = await supabase.from('tickets').select('*').limit(1);

    if (error) {
        console.error("ERROR fetching tickets:", error);
    } else {
        if (data && data.length > 0) {
            console.log("Columns found (from sample row):", Object.keys(data[0]));
        } else {
            console.log("No rows in tickets table. Cannot infer columns easily via select *.");

            // Try to select specific columns one by one to see if they error out
            const colsToCheck = ['route_name', 'bus_number', 'worker_id', 'establishment_id'];
            for (const col of colsToCheck) {
                const { error: colErr } = await supabase.from('tickets').select(col).limit(1);
                if (colErr) console.log(`Column '${col}' missing or error:`, colErr.message);
                else console.log(`Column '${col}' EXISTS.`);
            }
        }
    }

    console.log("Checking 'workers' table relationship...");
    // Try to select from workers via tickets
    const { data: wData, error: wError } = await supabase.from('tickets').select('workers(id)').limit(1);

    if (wError) {
        console.error("Link to 'workers' FAILED:", wError);
        console.log("Possible causes: 1. FK missing. 2. FK name different. 3. RLS on workers table blocking access.");
    } else {
        console.log("Link to 'workers' SUCCESS:", wData);
    }
}

checkSchema();
