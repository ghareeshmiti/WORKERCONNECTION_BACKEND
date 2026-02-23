
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' }); // Adjust path to find .env in root

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupFamily() {
    console.log('Setting up Family Identity Data...');

    const FAMILY_ID = 'fam_ganti_001';

    // 1. Create/Update Members
    const familyMembers = [
        {
            worker_id: '998877665544', // Head (Bhargava)
            first_name: 'Bhargava',
            last_name: 'Ganti',
            date_of_birth: '1980-05-15',
            gender: 'Male',
            photo_url: 'https://randomuser.me/api/portraits/men/32.jpg',
            family_id: FAMILY_ID,
            relation: 'Self (Head)'
        },
        {
            worker_id: 'fam_wife_001',
            first_name: 'Sujatha',
            last_name: 'Ganti',
            date_of_birth: '1985-08-20',
            gender: 'Female',
            photo_url: 'https://randomuser.me/api/portraits/women/44.jpg',
            family_id: FAMILY_ID,
            relation: 'Wife'
        },
        {
            worker_id: 'fam_son1_001',
            first_name: 'Rahul',
            last_name: 'Ganti',
            date_of_birth: '2010-02-10',
            gender: 'Male',
            photo_url: 'https://randomuser.me/api/portraits/men/15.jpg',
            family_id: FAMILY_ID,
            relation: 'Son'
        },
        {
            worker_id: 'fam_son2_001',
            first_name: 'Rohan',
            last_name: 'Ganti',
            date_of_birth: '2012-11-05',
            gender: 'Male',
            photo_url: 'https://randomuser.me/api/portraits/men/18.jpg',
            family_id: FAMILY_ID,
            relation: 'Son'
        },
        { // Father
            worker_id: 'fam_father_001',
            first_name: 'Suryanarayana',
            last_name: 'Ganti',
            date_of_birth: '1955-01-01',
            gender: 'Male',
            photo_url: 'https://randomuser.me/api/portraits/men/85.jpg',
            family_id: FAMILY_ID,
            relation: 'Father'
        },
        { // Mother
            worker_id: 'fam_mother_001',
            first_name: 'Lakshmi',
            last_name: 'Ganti',
            date_of_birth: '1960-06-15',
            gender: 'Female',
            photo_url: 'https://randomuser.me/api/portraits/women/66.jpg',
            family_id: FAMILY_ID,
            relation: 'Mother'
        }
    ];

    for (const member of familyMembers) {
        // Upsert logic
        const { data: existing } = await supabase
            .from('workers')
            .select('id')
            .eq('worker_id', member.worker_id)
            .maybeSingle();

        if (existing) {
            console.log(`Updating ${member.first_name}...`);
            const { error } = await supabase
                .from('workers')
                .update({
                    family_id: member.family_id,
                    // Add relation if column exists, otherwise skip to avoid error? 
                    // Ideally we need to alter table first. 
                    // For now, let's just update family_id which is critical.
                })
                .eq('worker_id', member.worker_id);

            if (error) {
                console.error(`Error updating ${member.first_name}:`, error.message);
                if (error.message.includes('column "family_id" of relation "workers" does not exist')) {
                    console.error("CRITICAL: You must add 'family_id' column to 'workers' table in Supabase Dashboard first!");
                    process.exit(1);
                }
            }
        } else {
            console.log(`Creating ${member.first_name}...`);
            const { error } = await supabase
                .from('workers')
                .insert([member]);

            if (error) console.error(`Error creating ${member.first_name}:`, error.message);
        }
    }

    console.log('✅ Family Setup Complete!');
}

setupFamily();
