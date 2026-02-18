
require('dotenv').config({ path: './server/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkWorkersSchema() {
    console.log("Checking workers table columns...");

    const { data, error } = await supabase.from('workers').select('*').limit(1);

    if (error) {
        console.error("ERROR fetching workers:", error);
    } else {
        if (data && data.length > 0) {
            console.log("Workers Columns:", Object.keys(data[0]));
        } else {
            console.log("No workers found to infer columns.");
            // Try to select first_name/last_name/name
            const cs = ['first_name', 'last_name', 'name', 'worker_id'];
            for (const col of cs) {
                const { error: colErr } = await supabase.from('workers').select(col).limit(1);
                if (colErr) console.log(`Column '${col}' missing/error:`, colErr.message);
                else console.log(`Column '${col}' EXISTS.`);
            }
        }
    }
}

checkWorkersSchema();
