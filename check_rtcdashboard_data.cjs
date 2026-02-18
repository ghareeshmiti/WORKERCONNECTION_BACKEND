
require('dotenv').config({ path: './server/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkDashboardData() {
    console.log("Checking Dashboard Data Aggregation...");

    // 1. Fetch tickets
    const { data: tickets, error } = await supabase
        .from('tickets')
        .select('id, fare, govt_subsidy_amount, is_free, establishment_id');

    if (error) {
        console.error("Error fetching tickets:", error);
        return;
    }

    console.log(`Total Tickets: ${tickets.length}`);

    let totalRevenue = 0;
    let totalSubsidy = 0;
    let freeTickets = 0;

    tickets.forEach(t => {
        totalRevenue += (t.fare || 0);
        totalSubsidy += (t.govt_subsidy_amount || 0);
        if (t.is_free) freeTickets++;
    });

    console.log(`Total Revenue (User Paid): ${totalRevenue}`);
    console.log(`Total Subsidy (Govt Paid): ${totalSubsidy}`);
    console.log(`Free Tickets: ${freeTickets}`);

    // Check specific depot stats if needed
}

checkDashboardData();
