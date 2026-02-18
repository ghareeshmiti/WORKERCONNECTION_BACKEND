
require('dotenv').config({ path: './server/.env' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
    const { data } = await supabase.from('tickets').select('*').limit(10).order('issued_at', { ascending: false });
    data.forEach(t => {
        if (t.id === 10 || t.id === '10') {
            console.log(`CHECK_FARE [${t.from_stop}|${t.to_stop}] Fare:${t.fare} Sub:${t.govt_subsidy_amount}`);
        }
    });
}
check();
