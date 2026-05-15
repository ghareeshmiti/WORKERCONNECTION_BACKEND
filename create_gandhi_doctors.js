import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import 'dotenv/config';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// List of doctors to create for Gandhi Hospital
const doctorsToCreate = [
  {
    name: "Dr. Ananya Reddy",
    email: "dr.ananya@gandhi.com",
    specialization: "General Medicine",
    qualification: "MBBS, MD",
    experience_years: 12,
    phone: "9876543210",
  },
  {
    name: "Dr. Vikram Singh",
    email: "dr.vikram@gandhi.com",
    specialization: "Cardiology",
    qualification: "MBBS, DM Cardiology",
    experience_years: 15,
    phone: "9876543211",
  },
  {
    name: "Dr. Sneha Rao",
    email: "dr.sneha@gandhi.com",
    specialization: "Gynecology",
    qualification: "MBBS, MS Gynecology",
    experience_years: 10,
    phone: "9876543212",
  },
  {
    name: "Dr. Rahul Sharma",
    email: "dr.rahul@gandhi.com",
    specialization: "Neurology",
    qualification: "MBBS, DM Neurology",
    experience_years: 18,
    phone: "9876543213",
  },
  {
    name: "Dr. Priya Patel",
    email: "dr.priya@gandhi.com",
    specialization: "Dental",
    qualification: "BDS, MDS",
    experience_years: 8,
    phone: "9876543214",
  }
];

const DEFAULT_PASSWORD = "Doctor@1234";

async function run() {
  const client = await pool.connect();
  try {
    // 1. Get Gandhi Hospital Establishment ID
    const hosp = await client.query(`SELECT id FROM establishments WHERE name = 'Gandhi Hospital' LIMIT 1`);
    if (hosp.rowCount === 0) throw new Error("Gandhi Hospital not found in DB");
    const establishmentId = hosp.rows[0].id;

    console.log(`🏥 Found Gandhi Hospital ID: ${establishmentId}`);
    console.log(`========================================`);

    for (const doc of doctorsToCreate) {
      console.log(`\n👨‍⚕️ Processing ${doc.name} (${doc.email})...`);

      // 2. Create Auth User using Supabase Admin API
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: doc.email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          role: 'DOCTOR',
          establishment_id: establishmentId,
          full_name: doc.name
        },
        app_metadata: {
          role: 'DOCTOR',
          establishment_id: establishmentId
        }
      });

      if (authError && !authError.message.includes('already been registered')) {
        console.error(`❌ Failed to create auth user for ${doc.email}:`, authError.message);
        continue; // Skip to next
      }

      let authUserId;
      if (authError && authError.message.includes('already been registered')) {
         console.log(`   User already exists in auth. Fetching ID...`);
         const existingUser = await client.query(`SELECT id FROM auth.users WHERE email = $1`, [doc.email]);
         authUserId = existingUser.rows[0].id;
      } else {
         authUserId = authData.user.id;
         console.log(`   ✅ Created auth.users record: ${authUserId}`);
      }

      // 3. Upsert into public.doctors table
      const doctorId = crypto.randomUUID();
      await client.query(`
        INSERT INTO doctors (id, auth_user_id, establishment_id, name, email, specialization, qualification, experience_years, phone, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
        ON CONFLICT (email) DO UPDATE 
        SET auth_user_id = $2, establishment_id = $3, name = $4, specialization = $6, qualification = $7, experience_years = $8, phone = $9
      `, [doctorId, authUserId, establishmentId, doc.name, doc.email, doc.specialization, doc.qualification, doc.experience_years, doc.phone]);

      console.log(`   ✅ Mapped to public.doctors table`);
    }

    console.log(`\n🎉 All doctors processed successfully!`);
    console.log(`Login Password for all doctors: ${DEFAULT_PASSWORD}`);

  } catch (err) {
    console.error('\n❌ Script Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
