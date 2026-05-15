import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || 'https://seecqtxhpsostjniabeo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addTgHealthData() {
  try {
    console.log("Adding Telangana Health Data...");

    // 1. Get the APHEALTH department ID (or any health dept)
    const { data: dept, error: deptErr } = await supabase
      .from('departments')
      .select('id')
      .limit(1)
      .single();

    if (deptErr) throw new Error("Could not find a department: " + deptErr.message);
    const deptId = dept.id;

    // 2. Insert Gandhi Hospital
    console.log("Inserting Gandhi Hospital...");
    const { data: hospital, error: hospErr } = await supabase
      .from('establishments')
      .insert({
        name: 'Gandhi Hospital',
        code: 'TG-GH-001',
        district: 'Hyderabad',
        state: 'Telangana',
        establishment_type: 'Hospital',
        department_id: deptId,
        state_tag: 'TG',
        is_active: true
      })
      .select()
      .single();

    if (hospErr) {
      if (hospErr.code === '23505') {
        console.log("Gandhi Hospital already exists.");
      } else {
        console.error("Hospital insert failed (might already exist): " + hospErr.message);
      }
    }

    // Fetch it to get the ID if it already existed
    const { data: existingHosp } = await supabase
      .from('establishments')
      .select('id')
      .ilike('name', '%Gandhi%')
      .limit(1)
      .single();

    const hospitalId = hospital?.id || existingHosp?.id;
    if (!hospitalId) throw new Error("Could not find or create Gandhi Hospital");

    // 3. Get some workers to assign records to
    const { data: workers, error: wrkErr } = await supabase
      .from('workers')
      .select('id')
      .limit(10);

    if (wrkErr || !workers.length) throw new Error("Could not find workers for records");

    console.log(`Found ${workers.length} workers. Generating health records...`);

    // 4. Generate random health records for Gandhi Hospital
    const schemes = ['State Health Scheme', 'State Health Scheme', 'EHS', 'PMJAY', 'Paid'];
    const services = ['Consultation', 'Pharmacy', 'Laboratory', 'Surgery'];
    const diagnoses = ['Fever', 'Diabetes', 'Hypertension', 'Viral Infection', 'Asthma', 'Typhoid', 'Dengue'];

    const recordsToInsert = [];

    for (let i = 0; i < 25; i++) {
      const worker = workers[Math.floor(Math.random() * workers.length)];
      const scheme = schemes[Math.floor(Math.random() * schemes.length)];
      const service = services[Math.floor(Math.random() * services.length)];
      const diagnosis = diagnoses[Math.floor(Math.random() * diagnoses.length)];

      let cost = Math.floor(Math.random() * 5000) + 500;
      let govtPaid = scheme === 'Paid' ? 0 : cost;

      if (scheme === 'State Health Scheme' && cost > 1000) { cost += 15000; govtPaid += 15000; }

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - Math.floor(Math.random() * 30));

      recordsToInsert.push({
        worker_id: worker.id,
        establishment_id: hospitalId,
        service_type: service,
        diagnosis: diagnosis,
        cost: cost,
        govt_paid: govtPaid,
        patient_paid: scheme === 'Paid' ? cost : 0,
        scheme_name: scheme,
        notes: "Auto-generated TG record",
        created_at: pastDate.toISOString()
      });
    }

    const { error: insErr } = await supabase
      .from('health_records')
      .insert(recordsToInsert);

    if (insErr) throw new Error("Failed to insert health records: " + insErr.message);

    console.log(`✅ Successfully added 25 new Telangana health records for Gandhi Hospital!`);

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

addTgHealthData();
