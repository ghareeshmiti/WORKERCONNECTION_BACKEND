
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service role for admin tasks

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupFamily() {
    console.log('Setting up Family Identity Data...');

    // 1. Define Family ID
    const FAMILY_ID = 'fam_ganti_001';

    // 2. Define Family Members
    const familyMembers = [
        {
            worker_id: '998877665544', // Card ID for Bhargava (Head)
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
        {
            worker_id: 'fam_father_001',
            first_name: 'Suryanarayana',
            last_name: 'Ganti',
            date_of_birth: '1955-01-01',
            gender: 'Male',
            photo_url: 'https://randomuser.me/api/portraits/men/85.jpg',
            family_id: FAMILY_ID,
            relation: 'Father'
        },
        {
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

    // 3. Process Each Member
    for (const member of familyMembers) {
        // Check if worker exists
        const { data: existing } = await supabase
            .from('workers')
            .select('id')
            .eq('worker_id', member.worker_id)
            .single();

        if (existing) {
            console.log(`Updating existing worker: ${member.first_name}`);
            const { error } = await supabase
                .from('workers')
                .update({
                    family_id: member.family_id,
                    // relation: member.relation // Assuming we might not have this column, but good to add if possible. 
                    // For now, let's stick to core fields + family_id
                })
                .eq('worker_id', member.worker_id);

            if (error) console.error(`Error updating ${member.first_name}:`, error.message);
        } else {
            console.log(`Creating new family member: ${member.first_name}`);
            const { error } = await supabase
                .from('workers')
                .insert([member]);

            if (error) console.error(`Error creating ${member.first_name}:`, error.message);
        }
    }

    console.log('Family setup complete.');
}

setupFamily().catch(console.error);
