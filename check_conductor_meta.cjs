
require('dotenv').config({ path: './server/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Ensure this is set in .env

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    console.log("URL:", supabaseUrl);
    console.log("KEY Length:", supabaseKey ? supabaseKey.length : 0);
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function checkConductor() {
    const { data: { users }, error } = await supabase.auth.admin.listUsers();

    if (error) {
        console.error("Error listing users:", error);
        return;
    }

    console.log(`Found ${users.length} users.`);

    const conductors = users.filter(u =>
        u.user_metadata?.role === 'employee' ||
        u.user_metadata?.role === 'conductor' ||
        (u.email || '').includes('conductor')
    );

    console.log(`Found ${conductors.length} potential conductors.`);

    conductors.forEach(u => {
        console.log("---------------------------------------------------");
        console.log(`Email: ${u.email}`);
        console.log(`ID: ${u.id}`);
        console.log("Metadata:", JSON.stringify(u.user_metadata, null, 2));
        console.log("App Metadata:", JSON.stringify(u.app_metadata, null, 2));
    });
}

checkConductor();
