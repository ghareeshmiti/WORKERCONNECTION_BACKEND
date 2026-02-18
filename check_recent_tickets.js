
require('dotenv').config({ path: './server/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing credentials");
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
        console.log(`ID: ${t.id} | Est: ${t.establishment_id} | Fare: ${t.fare} | Sub: ${t.govt_subsidy_amount} | Created: ${t.issued_at}`);
    });
}

checkTickets();
