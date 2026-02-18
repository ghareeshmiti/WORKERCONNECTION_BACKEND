
require('dotenv').config({ path: './server/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing credentials");
    console.log("URL:", supabaseUrl);
    console.log("Key Length:", supabaseKey ? supabaseKey.length : 0);
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTickets() {
    const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .order('issued_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error("Error fetching tickets:", error);
        return;
    }

    console.log(`Found ${data.length} recent tickets.`);
    data.forEach(t => {
        if (t.id === 10) {
            console.log(`ID:${t.id} Sub:${t.govt_subsidy_amount} Free:${t.is_free} FareCol:${t.fare} From:'${t.from_stop}' To:'${t.to_stop}'`);
        }
    });
}

checkTickets();
