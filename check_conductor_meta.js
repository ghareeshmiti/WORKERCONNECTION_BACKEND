
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkConductor() {
    // Try to find the conductor user. We don't know the exact email, so let's list recent users or search by a likely email if known.
    // Or just list all users and filter for role 'employee' or 'conductor'

    const { data: { users }, error } = await supabase.auth.admin.listUsers();

    if (error) {
        console.error("Error listing users:", error);
        return;
    }

    console.log(`Found ${users.length} users.`);

    const conductors = users.filter(u =>
        u.user_metadata?.role === 'employee' ||
        u.user_metadata?.role === 'conductor' ||
        u.email?.includes('conductor')
    );

    console.log(`Found ${conductors.length} potential conductors.`);

    conductors.forEach(u => {
        console.log("---------------------------------------------------");
        console.log(`Email: ${u.email}`);
        console.log(`ID: ${u.id}`);
        console.log("Metadata:", u.user_metadata);
        console.log("App Metadata:", u.app_metadata);
    });
}

checkConductor();
