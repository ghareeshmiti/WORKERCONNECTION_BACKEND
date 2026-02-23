
import 'dotenv/config'; // Load env vars
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import crypto from 'crypto';
import pg from 'pg'; // PostgreSQL
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Initialize Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Run lightweight migrations on startup (safe to re-run)
pool.query(`ALTER TABLE patient_queue ADD COLUMN IF NOT EXISTS vitals JSONB`).catch(() => {});

// Initialize Supabase Admin (for Auth)
const supabaseUrl = process.env.SUPABASE_URL || 'https://seecqtxhpsostjniabeo.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

// Global settings
const rpName = 'FIDO Check-in System';

const getRpConfig = (req) => {
  const origin = req.get('origin');
  let rpID = req.hostname;

  if (origin) {
    try {
      const url = new URL(origin);
      rpID = url.hostname;
    } catch (e) {
      console.warn('Failed to parse origin:', origin);
    }
  }

  // For mobile app requests (no origin header), use the known rpID
  // The FIDO2 credentials are registered under workerconnect.miti.us
  if (!origin) {
    rpID = 'workerconnect.miti.us';
  }

  return { rpID, origin: origin || `https://workerconnect.miti.us` };
};

// --- HELPER ISOBUE ---
const isoBase64URL = {
  fromBuffer: (buffer) => {
    if (!buffer) return '';
    const base64 = Buffer.from(buffer).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  },
  toBuffer: (base64url) => {
    if (!base64url) return Buffer.alloc(0);
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64');
  }
}

// --- DB HELPERS (ASYNC for Postgres) ---

async function getOrCreateUser(username) {
  const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  let user = res.rows[0];

  if (!user) {
    const userId = crypto.randomBytes(16); // Buffer
    await pool.query('INSERT INTO users (username, id) VALUES ($1, $2)', [username, userId]);
    user = { username, id: userId, currentChallenge: null };
  }

  // Sync with Workers table (New Schema Support)
  // Check if worker exists
  const workerRes = await pool.query('SELECT id FROM workers WHERE worker_id = $1', [username]);
  if (workerRes.rowCount === 0) {
    // Create default worker profile
    await pool.query(`
          INSERT INTO workers 
          (worker_id, first_name, last_name, state, district, status, is_active)
          VALUES ($1, $2, $3, 'Telangana', 'Hyderabad', 'new', true)
      `, [username, username, 'User']); // Defaulting Name to username, Location to Hyd
    console.log(`Auto-created worker profile for ${username}`);
  }

  return user;
}

async function getUserAuthenticators(username) {
  const res = await pool.query('SELECT * FROM authenticators WHERE username = $1', [username]);
  return res.rows.map(row => ({
    credentialID: row.credentialID, // Buffer (BYTEA)
    credentialPublicKey: row.credentialPublicKey, // Buffer (BYTEA)
    counter: row.counter,
    transports: JSON.parse(row.transports || '[]')
  }));
}

async function saveAuthenticator(username, authenticator) {
  await pool.query(
    `INSERT INTO authenticators ("credentialID", username, "credentialPublicKey", counter, transports)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      authenticator.credentialID,
      username,
      authenticator.credentialPublicKey,
      authenticator.counter,
      JSON.stringify(authenticator.transports)
    ]
  );
}

async function updateAuthenticatorCounter(credentialID, newCounter) {
  await pool.query('UPDATE authenticators SET counter = $1 WHERE "credentialID" = $2', [newCounter, credentialID]);
}

async function getCheckStatus(username) {
  // Try to get status from new schema first
  try {
    const workerRes = await pool.query('SELECT id FROM workers WHERE worker_id = $1', [username]);
    if (workerRes.rows[0]) {
      const lastEventRes = await pool.query(
        'SELECT event_type, occurred_at FROM attendance_events WHERE worker_id = $1 ORDER BY occurred_at DESC LIMIT 1',
        [workerRes.rows[0].id]
      );
      if (lastEventRes.rows[0]) {
        const evt = lastEventRes.rows[0];
        return {
          status: evt.event_type === 'CHECK_IN' ? 'in' : 'out',
          timestamp: evt.occurred_at
        };
      }
    }
  } catch (e) {
    console.error("Error reading new schema status", e);
  }

  // Fallback to legacy checks table (if empty or migration issues)
  const res = await pool.query('SELECT status, timestamp FROM checks WHERE username = $1', [username]);
  return res.rows[0] || { status: 'out', timestamp: null };
}

async function upsertDailyRollup(workerId, establishmentId, eventType, timestamp) {
  const date = timestamp.split('T')[0]; // YYYY-MM-DD

  try {
    // Check if rollup exists
    const res = await pool.query(
      'SELECT * FROM attendance_daily_rollups WHERE worker_id = $1 AND attendance_date = $2',
      [workerId, date]
    );

    let rollup = res.rows[0];

    if (!rollup) {
      // Create new rollup
      await pool.query(`
        INSERT INTO attendance_daily_rollups 
        (worker_id, establishment_id, attendance_date, status, first_checkin_at, total_hours)
        VALUES ($1, $2, $3, 'PRESENT', $4, 0)
      `, [workerId, establishmentId, date, eventType === 'CHECK_IN' ? timestamp : null]);
    } else {
      // Update existing
      if (eventType === 'CHECK_OUT') {
        // Calculate duration roughly (last_checkout - first_checkin) or just update last_checkout
        // Ideally calculate based on sessions, but for now simple update
        await pool.query(`
           UPDATE attendance_daily_rollups 
           SET last_checkout_at = $1, 
               status = 'PRESENT',
               total_hours = ROUND(CAST(EXTRACT(EPOCH FROM ($1::timestamp - first_checkin_at)) / 3600 AS numeric), 2)
           WHERE id = $2
         `, [timestamp, rollup.id]);
      } else if (eventType === 'CHECK_IN' && !rollup.first_checkin_at) {
        // Backfill first checkin if missing
        await pool.query(`
           UPDATE attendance_daily_rollups 
           SET first_checkin_at = $1
           WHERE id = $2
         `, [timestamp, rollup.id]);
      }
    }
  } catch (e) {
    console.error('Error syncing rollup:', e);
  }
}

async function updateCheckStatus(username, status, location = 'Unknown') {
  const timestamp = new Date().toISOString();

  // 1. Find Worker UUID from worker_id (username)
  const workerRes = await pool.query('SELECT id FROM workers WHERE worker_id = $1', [username]);
  const worker = workerRes.rows[0];

  if (!worker) {
    console.warn(`Worker profile not found for ${username}. Authentication successful but attendance NOT recorded.`);
    return; // Or throw error?
  }

  // 2. Find Establishment (Resolve from Location Name first, then Mapping)
  let establishmentId = null;

  // Try to find establishment by Name (passed as location)
  if (location && location !== 'Unknown') {
    const estRes = await pool.query('SELECT id FROM establishments WHERE name = $1', [location]);
    if (estRes.rows.length > 0) {
      establishmentId = estRes.rows[0].id;
    }
  }

  // Fallback: Check worker mapping
  if (!establishmentId) {
    const mappingRes = await pool.query(
      'SELECT establishment_id FROM worker_mappings WHERE worker_id = $1 AND is_active = true',
      [worker.id]
    );
    establishmentId = mappingRes.rows[0]?.establishment_id || null;
  }

  // 3. Determine Event Type (CHECK_IN / CHECK_OUT)
  // We can trust the passed 'status' if 'in' -> 'CHECK_IN', 'out' -> 'CHECK_OUT'
  // logic in calling function already toggles it based on previous state. 
  // Wait, previous state was from 'checks' table. We should now check 'attendance_daily_rollups' or 'attendance_events'.

  const eventType = status === 'in' ? 'CHECK_IN' : 'CHECK_OUT';

  // 4. Insert Event
  await pool.query(`
    INSERT INTO attendance_events 
    (worker_id, event_type, establishment_id, occurred_at, region)
    VALUES ($1, $2, $3, $4, $5)
  `, [worker.id, eventType, establishmentId, timestamp, location]);

  // 5. Sync Rollup (Dashboard View)
  if (establishmentId) {
    if (upsertDailyRollup) await upsertDailyRollup(worker.id, establishmentId, eventType, timestamp);
  }

  // Legacy support cleanup (optional, keeping valid for now)
  /*
  await pool.query(`
    INSERT INTO checks (username, status, timestamp) 
    VALUES ($1, $2, $3)
    ON CONFLICT (username) 
    DO UPDATE SET status = $2, timestamp = $3
  `, [username, status, timestamp]);
  */
}

async function updateUserChallenge(username, challenge) {
  await pool.query('UPDATE users SET "currentChallenge" = $1 WHERE username = $2', [challenge, username]);
}

// --- ENDPOINTS ---

app.get('/', (req, res) => { res.send('FIDO Server Running (Supabase/Postgres)'); });


// REGISTRATION
app.post('/api/register/begin', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const user = await getOrCreateUser(username);
    const rpConfig = getRpConfig(req);

    const allAuthsRes = await pool.query('SELECT "credentialID", transports FROM authenticators');
    const allAuthenticators = allAuthsRes.rows.map(row => ({
      credentialID: row.credentialID,
      transports: JSON.parse(row.transports || '[]')
    }));

    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpConfig.rpID || 'localhost',
      userID: new Uint8Array(user.id),
      userName: user.username,
      attestationType: 'direct',
      excludeCredentials: allAuthenticators.map(auth => ({
        id: isoBase64URL.fromBuffer(auth.credentialID),
        type: 'public-key',
        transports: auth.transports,
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
        authenticatorAttachment: 'cross-platform',
      },
    });

    await updateUserChallenge(username, options.challenge);
    res.json(options);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/register/finish', async (req, res) => {
  const { username, body } = req.body;
  const user = await getOrCreateUser(username);

  try {
    const { rpID, origin } = getRpConfig(req);

    // Accept Android app origins for mobile registration
    let expectedOrigins = [origin, `https://${rpID}`];
    try {
      const clientData = JSON.parse(Buffer.from(body.response.clientDataJSON, 'base64url').toString('utf8'));
      if (clientData.origin && clientData.origin.startsWith('android:')) {
        expectedOrigins.push(clientData.origin);
      }
    } catch (e) { /* ignore */ }

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
    });

    const { verified, registrationInfo } = verification;

    if (verified && registrationInfo) {
      let { credentialPublicKey, credentialID, counter } = registrationInfo;

      if (!credentialID && registrationInfo.credential) {
        if (registrationInfo.credential.id) credentialID = registrationInfo.credential.id;
        if (registrationInfo.credential.publicKey) credentialPublicKey = registrationInfo.credential.publicKey;
        if (registrationInfo.credential.counter) counter = registrationInfo.credential.counter;
      }

      if (!credentialID) throw new Error('credentialID is null');

      let credIdBuffer;
      if (typeof credentialID === 'string') {
        credIdBuffer = isoBase64URL.toBuffer(credentialID);
      } else {
        credIdBuffer = Buffer.from(credentialID);
      }

      // Check collision
      const existingAuthRes = await pool.query('SELECT * FROM authenticators WHERE "credentialID" = $1', [credIdBuffer]);
      if (existingAuthRes.rows.length > 0) {
        throw new Error('This card is already registered to a user.');
      }

      const pubKeyBuffer = Buffer.from(credentialPublicKey);

      await saveAuthenticator(username, {
        credentialID: credIdBuffer,
        credentialPublicKey: pubKeyBuffer,
        counter,
        transports: body.response.transports
      });

      await updateUserChallenge(username, null);
      res.json({ verified: true });
    } else {
      res.status(400).json({ verified: false, error: 'Verification returned false' });
    }
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});


// AUTHENTICATION
app.post('/api/login/begin', async (req, res) => {
  let { username } = req.body;
  let allowCredentials = [];
  let user;

  // If username is a 12-digit Aadhaar number, resolve to worker_id
  if (username && /^\d{12}$/.test(username)) {
    const workerRes = await pool.query('SELECT worker_id FROM workers WHERE aadhaar_number = $1', [username]);
    if (workerRes.rowCount > 0) {
      username = workerRes.rows[0].worker_id;
      console.log(`Resolved Aadhaar to worker_id: ${username}`);
    } else {
      return res.status(404).json({ error: 'No worker found with this Aadhaar number' });
    }
  }

  if (username) {
    user = await getOrCreateUser(username);
    const authenticators = await getUserAuthenticators(username);

    // Check removed per user request for simplfied flow


    allowCredentials = authenticators.map(dev => ({
      id: isoBase64URL.fromBuffer(dev.credentialID),
      type: 'public-key',
      transports: dev.transports,
    }));
  } else {
    // Usernameless flow: return ALL registered credentials so Android Credential
    // Manager can match against NFC security keys. Browsers handle empty
    // allowCredentials natively, but Android needs explicit credential IDs
    // to prompt for NFC security key. The user is identified after auth
    // via the credential used + userHandle.
    const allAuthRes = await pool.query('SELECT "credentialID", transports FROM authenticators');
    if (allAuthRes.rowCount > 0) {
      allowCredentials = allAuthRes.rows.map(row => ({
        id: isoBase64URL.fromBuffer(row.credentialID),
        type: 'public-key',
        transports: JSON.parse(row.transports || '[]'),
      }));
    }
  }

  const { rpID } = getRpConfig(req);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'preferred',
  });

  if (user) {
    await updateUserChallenge(username, options.challenge);
  } else {
    pendingChallenges.set(options.challenge, { timestamp: Date.now() });
  }

  res.json(options);
});

const pendingChallenges = new Map();

app.post('/api/login/finish', async (req, res) => {
  let { username, body, action, location } = req.body;
  let user;
  let currentChallenge;

  try {
    // If username is a 12-digit Aadhaar number, resolve to worker_id
    if (username && /^\d{12}$/.test(username)) {
      const workerRes = await pool.query('SELECT worker_id FROM workers WHERE aadhaar_number = $1', [username]);
      if (workerRes.rowCount > 0) {
        username = workerRes.rows[0].worker_id;
      }
    }

    if (username) {
      user = await getOrCreateUser(username);
      currentChallenge = user.currentChallenge;
    } else {
      // Usernameless
      const response = body.response;
      if (!response.userHandle) throw new Error('User handle missing in response');

      const userHandleBuffer = isoBase64URL.toBuffer(response.userHandle);
      const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userHandleBuffer]);
      user = userRes.rows[0];

      if (!user) throw new Error('User not found from userHandle');

      const clientData = JSON.parse(Buffer.from(body.response.clientDataJSON, 'base64url').toString('utf8'));
      const returnedChallenge = clientData.challenge;

      if (pendingChallenges.has(returnedChallenge)) {
        currentChallenge = returnedChallenge;
        pendingChallenges.delete(returnedChallenge);
      } else {
        throw new Error('Challenge not found or expired');
      }
    }

    const authenticators = await getUserAuthenticators(user.username);
    const dbAuthenticator = authenticators.find(dev => {
      return isoBase64URL.fromBuffer(dev.credentialID) === body.id;
    });

    if (!dbAuthenticator) throw new Error('Authenticator not found');

    const { rpID, origin } = getRpConfig(req);

    // For mobile apps (Android), the origin in clientDataJSON may be
    // "android:apk-key-hash:<SHA256>" instead of a web URL.
    // Extract actual origin from clientDataJSON to handle this.
    let expectedOrigins = [origin, `https://${rpID}`];
    try {
      const clientData = JSON.parse(Buffer.from(body.response.clientDataJSON, 'base64url').toString('utf8'));
      if (clientData.origin && !expectedOrigins.includes(clientData.origin)) {
        // Accept Android app origins (android:apk-key-hash:...)
        if (clientData.origin.startsWith('android:')) {
          expectedOrigins.push(clientData.origin);
        }
      }
    } catch (e) { /* ignore parse errors, let verification handle it */ }

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: currentChallenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      credential: {
        id: dbAuthenticator.credentialID,
        publicKey: dbAuthenticator.credentialPublicKey,
        counter: dbAuthenticator.counter || 0,
        transports: dbAuthenticator.transports,
      },
    });

    const { verified, authenticationInfo } = verification;

    if (verified) {
      await updateAuthenticatorCounter(dbAuthenticator.credentialID, authenticationInfo.newCounter);
      if (username) await updateUserChallenge(username, null);

      let status = 'out';
      let message = 'Authenticated';
      let session = null;
      let supabaseUser = null;

      if (action === 'toggle') {
        const check = await getCheckStatus(user.username);
        status = check.status === 'out' ? 'in' : 'out';
        await updateCheckStatus(user.username, status, location);
        message = status === 'in' ? `Welcome back ${user.username}! Checked In.` : `Goodbye ${user.username}! Checked Out.`;
      } else {
        // LOGIN ACTION: Generate Supabase Session if it's a worker
        try {
          // Check if this username belongs to a worker
          const wRes = await pool.query("SELECT * FROM workers WHERE worker_id = $1", [user.username]);
          if (wRes.rows.length > 0 && supabaseAdmin) {
            const worker = wRes.rows[0];
            const email = `${worker.worker_id}@worker.miti.app`.toLowerCase();
            // Use same deterministic password logic as worker-login
            const password = `WkrLogin#${worker.worker_id}#${process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.slice(0, 5) : 'dev'}`;

            let { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });

            if (error) {
              // If login fails (maybe first time FIDO user but shadow user not forced yet?), try create/update
              // This mimics the robust logic in /api/auth/worker-login
              const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: {
                  role: 'worker',
                  worker_id: worker.worker_id,
                  worker_uuid: worker.id,
                  aadhaar_last_four: worker.aadhaar_number ? worker.aadhaar_number.slice(-4) : '0000'
                }
              });

              if (createError) {
                if (createError.message?.includes('already registered')) {
                  // Update to ensure password match
                  const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
                  const existing = userList.users.find(u => u.email === email);
                  if (existing) {
                    await supabaseAdmin.auth.admin.updateUserById(existing.id, { password });
                  }
                  const retry = await supabaseAdmin.auth.signInWithPassword({ email, password });
                  data = retry.data;
                  error = retry.error;
                }
              } else {
                // Created new
                const retry = await supabaseAdmin.auth.signInWithPassword({ email, password });
                data = retry.data;
                error = retry.error;
              }
            }

            if (!error && data) {
              session = data.session;
              supabaseUser = data.user;
            }
          }
        } catch (sessErr) {
          console.error('Failed to generate session for FIDO user:', sessErr);
          // Don't block FIDO success, but client might fail to redirect
        }
      }

      res.json({ verified: true, status, message, username: user.username, session, user: supabaseUser });
    } else {
      res.status(400).json({ verified: false });
    }

  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});


// ADMIN
app.get('/api/admin/data', async (req, res) => {
  try {
    const usersRes = await pool.query('SELECT * FROM users');
    const checksRes = await pool.query('SELECT * FROM checks');
    const authsRes = await pool.query('SELECT username, counter, "credentialID" FROM authenticators');

    const users = usersRes.rows;
    const checks = checksRes.rows;
    const auths = authsRes.rows;

    const data = users.map(u => {
      const check = checks.find(c => c.username === u.username) || { status: 'out', timestamp: null };
      const userAuths = auths.filter(a => a.username === u.username);
      return {
        username: u.username,
        status: check.status,
        lastSeen: check.timestamp,
        deviceCount: userAuths.length,
        totalLogins: userAuths.reduce((acc, curr) => acc + (curr.counter || 0), 0)
      };
    });

    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ADMIN - AUDIT LOGS
app.get('/api/admin/audit/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const resLogs = await pool.query('SELECT * FROM audit_logs WHERE username = $1 ORDER BY timestamp DESC LIMIT 50', [username]);
    res.json(resLogs.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ADMIN - EXPORT
app.get('/api/admin/export', async (req, res) => {
  try {
    const resLogs = await pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC');
    res.json(resLogs.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// REGISTER DEPARTMENT (Moved from Edge Function)
app.post('/api/register/department', async (req, res) => {
  const { name, code, email, password, phone, state, district, mandal, pincode, addressLine } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  // Ensure Service Key is set
  if (!supabaseAdmin) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ success: false, message: 'Server misconfiguration: Missing Admin Key' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check if email exists in Departments (Public Table)
    const checkRes = await client.query('SELECT id FROM departments WHERE email = $1', [email]);
    if (checkRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    // 2. Create User in Supabase Auth (Using Admin API to avoid SQL Trigger issues)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true, // Auto-confirm
      user_metadata: { role: 'department' }
    });

    if (authError) {
      await client.query('ROLLBACK');
      console.error('Supabase Auth Error:', authError);
      return res.status(400).json({ success: false, message: authError.message });
    }

    const userId = authData.user.id;

    // 3. Insert into public.departments (using the Auth ID as the Department ID for linkage)
    await client.query(`
      INSERT INTO departments (
        id, name, code, state, district, mandal, pincode, address_line, phone, email, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW(), NOW())
    `, [userId, name, code, state, district, mandal, pincode, addressLine, phone, email]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Department registered successfully' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Registration error:', error);
    // Attempt cleanup
    if (supabaseAdmin && error.message !== 'Email already registered') {
      // await supabaseAdmin.auth.admin.deleteUser(userId); 
    }
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

// PUBLIC WORKER REGISTRATION
app.post('/api/public/register-worker', async (req, res) => {
  const {
    firstName, lastName, gender, dob, phone, aadhaarNumber,
    state, district, mandal, village, pincode, addressLine,
    eshramId, bocwId,
    fatherName, motherName, bankAccountNumber, ifscCode,
    maritalStatus, caste, disabilityStatus, nresMember, tradeUnionMember,
    educationLevel, skillCategory, workHistory, photoUrl
  } = req.body;

  if (!firstName || !lastName || !phone || !aadhaarNumber || !district || !mandal) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    // 1. Generate Worker ID (Format: WKR + Timestamp(6) + Random(4))
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(1000 + Math.random() * 9000).toString();
    const workerId = `WKR${timestamp}${random}`;

    // 2. Insert into workers table
    const aadhaarLastFour = aadhaarNumber.slice(-4);

    await client.query(`
          INSERT INTO workers (
              worker_id, first_name, last_name, gender, date_of_birth, phone,
              aadhaar_number, aadhaar_last_four,
              state, district, mandal, village, pincode, address_line,
              eshram_id, bocw_id,
              father_name, mother_name, bank_account_number, ifsc_code,
              marital_status, caste, disability_status, nres_member, trade_union_member,
              education_level, skill_category, work_history, photo_url,
              status, is_active, created_at, updated_at
          ) VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8,
              $9, $10, $11, $12, $13, $14,
              $15, $16,
              $17, $18, $19, $20,
              $21, $22, $23, $24, $25,
              $26, $27, $28, $29,
              'new', true, NOW(), NOW()
          )
      `, [
      workerId, firstName, lastName, gender, dob, phone,
      aadhaarNumber, aadhaarLastFour,
      state, district, mandal, village, pincode, addressLine,
      eshramId, bocwId,
      fatherName, motherName, bankAccountNumber, ifscCode,
      maritalStatus, caste, disabilityStatus, nresMember, tradeUnionMember,
      educationLevel, skillCategory, workHistory, photoUrl
    ]);

    res.json({ success: true, message: 'Worker registered successfully', workerId });

  } catch (error) {
    console.error('Worker Reg Error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

// REGISTER ESTABLISHMENT
app.post('/api/register/establishment', async (req, res) => {
  const {
    name, code, description, establishmentType, email, password, phone,
    state, district, mandal, pincode, addressLine,
    licenseNumber, departmentId, constructionType, projectName, contractorName,
    estimatedWorkers, startDate, expectedEndDate
  } = req.body;

  if (!email || !password || !name || !departmentId) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  // Ensure Service Key is set
  if (!supabaseAdmin) {
    return res.status(500).json({ success: false, message: 'Server misconfiguration: Missing Admin Key' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check if email exists
    const checkRes = await client.query('SELECT id FROM establishments WHERE email = $1', [email]);
    if (checkRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    // 2. Create User in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: { role: 'establishment' }
    });

    if (authError) {
      await client.query('ROLLBACK');
      console.error('Supabase Auth Error:', authError);
      return res.status(400).json({ success: false, message: authError.message });
    }

    const userId = authData.user.id;

    // 3. Insert into public.establishments
    await client.query(`
      INSERT INTO establishments (
        id, department_id, name, code, description, establishment_type,
        state, district, mandal, pincode, address_line, phone, email,
        license_number, construction_type, project_name, contractor_name,
        estimated_workers, start_date, expected_end_date,
        is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20,
        false, NOW(), NOW()
      )
    `, [
      userId, departmentId, name, code, description, establishmentType,
      state, district, mandal, pincode, addressLine, phone, email,
      licenseNumber, constructionType, projectName, contractorName,
      estimatedWorkers || 0, startDate || null, expectedEndDate || null
    ]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Establishment registered successfully' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Establishment Registration error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});



// ACTIVATE ESTABLISHMENT (APPROVE)
app.post('/api/admin/approve-establishment', async (req, res) => {
  const { establishmentId, cardReaderId, approvedBy } = req.body;

  if (!establishmentId || !cardReaderId) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE establishments 
      SET 
        is_approved = true,
        is_active = true,
        card_reader_id = $1,
        approved_by = $2,
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
      RETURNING id
    `, [cardReaderId, approvedBy || null, establishmentId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Establishment not found' });
    }

    res.json({ success: true, message: 'Establishment approved successfully' });
  } catch (error) {
    console.error('Approval Error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

// DELETE USER
app.delete('/api/admin/user/:username', async (req, res) => {
  const { username } = req.params;
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM authenticators WHERE username = $1', [username]);
    await pool.query('DELETE FROM checks WHERE username = $1', [username]);
    await pool.query('DELETE FROM audit_logs WHERE username = $1', [username]);
    const userDel = await pool.query('DELETE FROM users WHERE username = $1', [username]);
    await pool.query('COMMIT');
    if (userDel.rowCount > 0) res.json({ success: true, message: `User ${username} deleted.` });
    else res.status(404).json({ error: 'User not found' });
  } catch (e) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  }
});

// STATUS
app.get('/api/status/:username', async (req, res) => {
  const { username } = req.params;
  const status = await getCheckStatus(username);
  res.json(status);
});


// APPROVE WORKER
app.put('/api/admin/workers/:id/approve', async (req, res) => {
  const { id } = req.params;
  // departmentId / establishmentId might be passed but for now we just activate logic
  // "Assign Card" = activate the worker (worker_id is the card)

  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE workers 
       SET status = 'active', 
           is_active = true, 
           updated_at = NOW() 
       WHERE ${/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? 'id = $1' : 'worker_id = $1'}
       RETURNING *`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    res.json({ success: true, message: 'Worker approved and activated successfully', worker: result.rows[0] });
  } catch (error) {
    console.error('Approval Error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

app.put('/api/admin/workers/:id/reject', async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body; // Expect a reason

  if (!reason) {
    return res.status(400).json({ success: false, message: 'Rejection reason is required' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE workers 
           SET status = 'rejected', 
               rejection_reason = $1, 
               is_active = false, 
               updated_at = NOW() 
           WHERE worker_id = $2 RETURNING *`,
      [reason, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    res.json({ success: true, message: 'Worker rejected successfully', worker: result.rows[0] });
  } catch (error) {
    console.error('Reject Worker Error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

// STATIONS
app.get('/api/admin/stations', async (req, res) => {
  try {
    const resStations = await pool.query('SELECT * FROM stations ORDER BY created_at DESC');
    res.json(resStations.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/stations', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Station Name required' });
  try {
    await pool.query(
      'INSERT INTO stations (name, description, created_at) VALUES ($1, $2, $3)',
      [name, description, new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('unique constraint') || e.code === '23505') {
      return res.status(409).json({ error: 'Station name already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/stations/:name', async (req, res) => {
  const { name } = req.params;
  try {
    await pool.query('DELETE FROM stations WHERE name = $1', [name]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Worker Aadhaar Auth ---

app.post('/api/auth/worker-otp', async (req, res) => {
  const { aadhaar } = req.body;
  if (!aadhaar) return res.status(400).json({ error: "Aadhaar required" });

  try {
    const { rows } = await pool.query("SELECT id FROM workers WHERE REPLACE(aadhaar_number, '-', '') = $1", [aadhaar]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "No worker found with this Aadhaar number" });
    }
    // Mock OTP (In prod, send SMS)
    console.log(`[OTP] Sent to worker ${rows[0].id}`);
    res.json({ success: true, message: "OTP sent successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/api/auth/worker-login', async (req, res) => {
  const { aadhaar, otp } = req.body;

  if (!otp || otp.length !== 6) {
    return res.status(400).json({ error: "Invalid OTP" });
  }

  try {
    const { rows } = await pool.query("SELECT * FROM workers WHERE REPLACE(aadhaar_number, '-', '') = $1", [aadhaar]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Worker not found" });
    }
    const worker = rows[0];

    if (!supabaseAdmin) {
      return res.status(500).json({ error: "Supabase Admin not configured" });
    }

    // Shadow User Strategy
    const email = `${worker.worker_id}@worker.miti.app`.toLowerCase();
    const password = `WkrLogin#${worker.worker_id}#${process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.slice(0, 5) : 'dev'}`;

    // Attempt Sign In
    let { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });

    // If failed, check if user needs creation
    if (error) {
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          role: 'worker',
          worker_id: worker.worker_id, // String ID (WKR...)
          worker_uuid: worker.id,      // UUID
          aadhaar_last_four: aadhaar.slice(-4)
        }
      });

      if (createError) {
        if (createError.message?.includes('already registered')) {
          // Update password AND metadata to ensure it matches
          const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
          const existing = userList.users.find(u => u.email === email);
          if (existing) {
            await supabaseAdmin.auth.admin.updateUserById(existing.id, {
              password,
              user_metadata: {
                ...existing.user_metadata,
                role: 'worker',
                worker_id: worker.worker_id,
                worker_uuid: worker.id,
                aadhaar_last_four: aadhaar.slice(-4)
              }
            });
          }
          // Retry login
          const retry = await supabaseAdmin.auth.signInWithPassword({ email, password });
          data = retry.data;
          error = retry.error;
        } else {
          throw createError;
        }
      } else {
        // User created, now login
        const retry = await supabaseAdmin.auth.signInWithPassword({ email, password });
        data = retry.data;
        error = retry.error;
      }
    }

    if (error) throw error;

    res.json({ session: data.session, user: data.user });

  } catch (err) {
    console.error('Worker Login Error:', err);
    res.status(500).json({ error: err.message });
  }
});

//--- nfc ---

// Register/assign a card UID to a worker
app.post('/api/admin/workers/register-card', async (req, res) => {
  const { worker_id, card_uid } = req.body;

  if (!worker_id || !card_uid) {
    return res.status(400).json({ error: 'worker_id and card_uid are required' });
  }

  const normalizedUid = card_uid.toUpperCase().trim();

  try {
    // Check if this card is already assigned to another worker
    const existing = await pool.query(
      `SELECT worker_id, first_name, last_name FROM workers WHERE UPPER(card_uid) = $1`,
      [normalizedUid]
    );

    if (existing.rows.length > 0 && existing.rows[0].worker_id !== worker_id) {
      return res.status(409).json({
        error: `This card is already assigned to worker ${existing.rows[0].worker_id} (${existing.rows[0].first_name} ${existing.rows[0].last_name})`
      });
    }

    // Assign card to the worker
    const result = await pool.query(
      `UPDATE workers SET card_uid = $1, updated_at = NOW() WHERE worker_id = $2 RETURNING *`,
      [normalizedUid, worker_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    res.json({ success: true, message: `Card ${normalizedUid} registered to worker ${worker_id}`, worker: result.rows[0] });
  } catch (err) {
    console.error('Register Card Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Unlink a card from a worker
app.delete('/api/admin/workers/:worker_id/card', async (req, res) => {
  const { worker_id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE workers SET card_uid = NULL, updated_at = NOW() WHERE worker_id = $1 RETURNING *`,
      [worker_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    res.json({ success: true, message: `Card unlinked from worker ${worker_id}` });
  } catch (err) {
    console.error('Unlink Card Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/nfc-login', async (req, res) => {
  const { cardId, uidHex } = req.body;

  // Use card UID (hex) as the primary identifier
  const lookup = (cardId || uidHex || '').toUpperCase().trim();
  if (!lookup) return res.status(400).json({ error: "cardId/uidHex required" });

  try {
    // Look up worker by card_uid column
    const { rows } = await pool.query(
      `SELECT * FROM workers WHERE UPPER(card_uid) = $1 LIMIT 1`,
      [lookup]
    );

    if (rows.length === 0) return res.status(404).json({ error: "No worker registered for this card. Please register your card first." });
    const worker = rows[0];

    if (!supabaseAdmin) return res.status(500).json({ error: "Supabase Admin not configured" });

    // Shadow User Strategy (same as worker-login)
    const email = `${worker.worker_id}@worker.miti.app`.toLowerCase();
    const password = `WkrLogin#${worker.worker_id}#${process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.slice(0, 5) : 'dev'}`;

    let { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });

    if (error) {
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          role: 'worker',
          worker_id: worker.worker_id,
          worker_uuid: worker.id,
        }
      });

      if (createError) {
        if (createError.message?.includes('already registered')) {
          const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
          const existing = userList.users.find(u => u.email === email);
          if (existing) {
            await supabaseAdmin.auth.admin.updateUserById(existing.id, {
              password,
              user_metadata: {
                ...existing.user_metadata,
                role: 'worker',
                worker_id: worker.worker_id,
                worker_uuid: worker.id,
              }
            });
          }
          const retry = await supabaseAdmin.auth.signInWithPassword({ email, password });
          data = retry.data;
          error = retry.error;
        } else {
          throw createError;
        }
      } else {
        const retry = await supabaseAdmin.auth.signInWithPassword({ email, password });
        data = retry.data;
        error = retry.error;
      }
    }

    if (action === 'toggle') {
      // Toggle attendance status
      const check = await getCheckStatus(worker.worker_id);
      const newStatus = check.status === 'out' ? 'in' : 'out';
      await updateCheckStatus(worker.worker_id, newStatus, location);
      const message = newStatus === 'in' ? `Welcome back ${worker.first_name}! Checked In.` : `Goodbye ${worker.first_name}! Checked Out.`;

      return res.json({
        success: true,
        verified: true,
        message,
        status: newStatus,
        worker,
        username: worker.worker_id
      });
    }

    // Default LOGIN action
    if (error) throw error;

    return res.json({ session: data.session, user: data.user, worker });

  } catch (err) {
    console.error('NFC Login Error:', err);
    return res.status(500).json({ error: err.message });
  }
});
// ---- nfc end---

// ==================== HEALTH API ====================

// GET /api/health/worker-lookup?worker_id=WKR... or ?card_uid=...
app.get('/api/health/worker-lookup', async (req, res) => {
  const { worker_id, card_uid } = req.query;
  try {
    let query, params;
    if (card_uid) {
      query = `SELECT id, worker_id, first_name, last_name, aadhaar_number, gender, dob, district, mandal, phone, photo_url, blood_group, allergies, chronic_conditions, scheme_name FROM workers WHERE card_uid = $1 LIMIT 1`;
      params = [card_uid];
    } else if (worker_id) {
      query = `SELECT id, worker_id, first_name, last_name, aadhaar_number, gender, dob, district, mandal, phone, photo_url, blood_group, allergies, chronic_conditions, scheme_name FROM workers WHERE worker_id = $1 LIMIT 1`;
      params = [worker_id];
    } else {
      return res.status(400).json({ error: 'worker_id or card_uid required' });
    }
    const result = await pool.query(query, params);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Worker not found' });
    const worker = result.rows[0];
    // Fetch recent records
    const records = await pool.query(`SELECT * FROM hospital_records WHERE worker_id = $1 ORDER BY created_at DESC LIMIT 10`, [worker.id]);
    const appointments = await pool.query(`SELECT * FROM health_appointments WHERE worker_id = $1 ORDER BY appointment_date ASC`, [worker.id]);
    const checkups = await pool.query(`SELECT * FROM health_checkups WHERE worker_id = $1 ORDER BY checkup_date DESC LIMIT 5`, [worker.id]);
    res.json({ worker, records: records.rows, appointments: appointments.rows, checkups: checkups.rows });
  } catch (err) {
    console.error('Health worker lookup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/health/record - Add a new health record
app.post('/api/health/record', async (req, res) => {
  const { worker_id, establishment_id, operator_id, service_type, scheme_name, diagnosis, description, cost, govt_paid } = req.body;
  try {
    const result = await pool.query(`
      INSERT INTO hospital_records (worker_id, establishment_id, operator_id, service_type, scheme_name, diagnosis, description, cost, govt_paid)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `, [worker_id, establishment_id, operator_id, service_type, scheme_name || 'Paid', diagnosis, description, cost || 0, govt_paid || 0]);
    res.json({ success: true, record: result.rows[0] });
  } catch (err) {
    console.error('Add health record error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/health/records - Get records for a hospital or all (dept)
app.get('/api/health/records', async (req, res) => {
  const { establishment_id, worker_id, service_type, scheme_name, diagnosis, from_date, to_date, limit = 100 } = req.query;
  try {
    let conditions = [];
    let params = [];
    let idx = 1;
    if (establishment_id) { conditions.push(`hr.establishment_id = $${idx++}`); params.push(establishment_id); }
    if (worker_id) { conditions.push(`hr.worker_id = $${idx++}`); params.push(worker_id); }
    if (service_type) { conditions.push(`hr.service_type = $${idx++}`); params.push(service_type); }
    if (scheme_name) { conditions.push(`hr.scheme_name = $${idx++}`); params.push(scheme_name); }
    if (diagnosis) { conditions.push(`hr.diagnosis ILIKE $${idx++}`); params.push(`%${diagnosis}%`); }
    if (from_date) { conditions.push(`hr.created_at >= $${idx++}`); params.push(from_date); }
    if (to_date) { conditions.push(`hr.created_at <= $${idx++}`); params.push(to_date); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit));
    const result = await pool.query(`
      SELECT hr.*, w.first_name, w.last_name, w.worker_id as worker_code, e.name as hospital_name
      FROM hospital_records hr
      LEFT JOIN workers w ON hr.worker_id = w.id
      LEFT JOIN establishments e ON hr.establishment_id = e.id
      ${where}
      ORDER BY hr.created_at DESC
      LIMIT $${idx}
    `, params);
    res.json({ records: result.rows });
  } catch (err) {
    console.error('Fetch health records error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/health/stats - Aggregated stats for dashboards
app.get('/api/health/stats', async (req, res) => {
  const { establishment_id, department_code = 'APHEALTH' } = req.query;
  try {
    let estFilter = establishment_id ? `AND hr.establishment_id = '${establishment_id}'` : '';

    // Get dept establishments (hospitals)
    const hospitals = await pool.query(`
      SELECT e.id, e.name, e.district, e.code,
        COUNT(hr.id) as records,
        COALESCE(SUM(hr.cost), 0) as total_cost,
        COALESCE(SUM(hr.govt_paid), 0) as govt_paid,
        COALESCE(SUM(hr.cost - hr.govt_paid), 0) as patient_paid
      FROM establishments e
      LEFT JOIN hospital_records hr ON hr.establishment_id = e.id
      WHERE e.establishment_type = 'Hospital'
      ${establishment_id ? `AND e.id = '${establishment_id}'` : ''}
      GROUP BY e.id, e.name, e.district, e.code
      ORDER BY records DESC
    `);

    // By scheme
    const byScheme = await pool.query(`
      SELECT scheme_name, COUNT(*) as records, SUM(cost) as total_cost, SUM(govt_paid) as govt_paid
      FROM hospital_records hr WHERE 1=1 ${estFilter}
      GROUP BY scheme_name ORDER BY records DESC
    `);

    // By service
    const byService = await pool.query(`
      SELECT service_type, COUNT(*) as records, SUM(cost) as total_cost
      FROM hospital_records hr WHERE 1=1 ${estFilter}
      GROUP BY service_type ORDER BY records DESC
    `);

    // By disease
    const byDisease = await pool.query(`
      SELECT diagnosis, COUNT(*) as records, SUM(cost) as total_cost, SUM(govt_paid) as govt_paid
      FROM hospital_records hr WHERE 1=1 ${estFilter} AND diagnosis IS NOT NULL
      GROUP BY diagnosis ORDER BY records DESC LIMIT 15
    `);

    // By district (drill-down)
    const byDistrict = await pool.query(`
      SELECT e.district, COUNT(hr.id) as records, SUM(hr.cost) as total_cost, SUM(hr.govt_paid) as govt_paid
      FROM hospital_records hr
      JOIN establishments e ON hr.establishment_id = e.id
      WHERE e.establishment_type = 'Hospital'
      ${establishment_id ? `AND e.id = '${establishment_id}'` : ''}
      GROUP BY e.district ORDER BY records DESC
    `);

    // Totals
    const totals = await pool.query(`
      SELECT COUNT(DISTINCT hr.worker_id) as unique_patients,
        COUNT(hr.id) as total_records,
        COALESCE(SUM(hr.cost), 0) as total_cost,
        COALESCE(SUM(hr.govt_paid), 0) as govt_paid
      FROM hospital_records hr
      LEFT JOIN establishments e ON hr.establishment_id = e.id
      WHERE e.establishment_type = 'Hospital'
      ${estFilter}
    `);

    res.json({
      hospitals: hospitals.rows,
      byScheme: byScheme.rows,
      byService: byService.rows,
      byDisease: byDisease.rows,
      byDistrict: byDistrict.rows,
      totals: totals.rows[0]
    });
  } catch (err) {
    console.error('Health stats error:', err);
    res.status(500).json({ error: err.message });
  }
});
// ==================== HEALTH API END ====================

// --- CONDUCTOR TICKETS ---
app.post('/api/conductor/tickets', async (req, res) => {
  const {
    ticketId, passengerName, source, destination, fare, issuedBy, paymentMode, busNumber,
    // New Fields
    workerId, establishmentId, routeId, routeName, fromStop, toStop, isFree, govtSubsidyAmount, conductorId, remarks
  } = req.body;

  try {
    await pool.query(
      `INSERT INTO tickets (
        ticket_id, passenger_name, source, destination, fare, issued_by, payment_mode, bus_number,
        worker_id, establishment_id, route_id, route_name, from_stop, to_stop, is_free, govt_subsidy_amount, conductor_id, remarks
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        ticketId, passengerName, source, destination, fare, issuedBy, paymentMode, busNumber,
        workerId || null, establishmentId || null, routeId, routeName, fromStop, toStop, isFree || false, govtSubsidyAmount || 0, conductorId || null, remarks
      ]
    );
    res.json({ success: true, message: 'Ticket saved' });
  } catch (e) {
    console.error('Error saving ticket:', e);
    res.status(500).json({ error: e.message });
  }
});
// ═══════════════════════════════════════════════════
// FAMILY APIs
// ═══════════════════════════════════════════════════

// Lookup family by NFC card UID → returns family + all members
app.get('/api/families/by-card/:cardUid', async (req, res) => {
  try {
    const rawParam = req.params.cardUid.trim();
    const cardUid = rawParam.toUpperCase().replace(/[^A-F0-9]/g, '');

    // Try finding worker by card_uid first, then by worker_id
    let workerRes = await pool.query(
      `SELECT id, worker_id, first_name, last_name, phone, district, card_uid
       FROM workers WHERE UPPER(card_uid) = $1 AND is_active = true`,
      [cardUid]
    );
    if (workerRes.rowCount === 0) {
      // Fallback: try matching by worker_id (for manual search)
      workerRes = await pool.query(
        `SELECT id, worker_id, first_name, last_name, phone, district, card_uid
         FROM workers WHERE worker_id = $1 AND is_active = true`,
        [rawParam]
      );
    }
    if (workerRes.rowCount === 0) {
      return res.status(404).json({ error: 'No worker found with this card' });
    }
    const worker = workerRes.rows[0];

    // Find family for this worker
    const familyRes = await pool.query(
      `SELECT id, family_name, address, district, phone
       FROM families WHERE head_worker_id = $1`,
      [worker.id]
    );
    if (familyRes.rowCount === 0) {
      return res.status(404).json({ error: 'No family registered for this card holder' });
    }
    const family = familyRes.rows[0];

    // Get all family members
    const membersRes = await pool.query(
      `SELECT id, name, relation, gender, date_of_birth, aadhaar_last_four,
              blood_group, allergies, chronic_conditions, phone, photo_url, is_active
       FROM family_members WHERE family_id = $1 AND is_active = true
       ORDER BY CASE relation
         WHEN 'SELF' THEN 1 WHEN 'SPOUSE' THEN 2 WHEN 'FATHER' THEN 3
         WHEN 'MOTHER' THEN 4 WHEN 'SON' THEN 5 WHEN 'DAUGHTER' THEN 6
         ELSE 7 END`,
      [family.id]
    );

    res.json({
      worker: { id: worker.id, worker_id: worker.worker_id, name: `${worker.first_name} ${worker.last_name || ''}`.trim() },
      family: { ...family, members: membersRes.rows }
    });
  } catch (e) {
    console.error('Error looking up family by card:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get all members of a family
app.get('/api/families/:familyId/members', async (req, res) => {
  try {
    const { familyId } = req.params;
    const membersRes = await pool.query(
      `SELECT id, name, relation, gender, date_of_birth, aadhaar_last_four,
              blood_group, allergies, chronic_conditions, phone, photo_url, is_active
       FROM family_members WHERE family_id = $1 AND is_active = true
       ORDER BY CASE relation
         WHEN 'SELF' THEN 1 WHEN 'SPOUSE' THEN 2 WHEN 'FATHER' THEN 3
         WHEN 'MOTHER' THEN 4 WHEN 'SON' THEN 5 WHEN 'DAUGHTER' THEN 6
         ELSE 7 END`,
      [familyId]
    );
    res.json({ members: membersRes.rows });
  } catch (e) {
    console.error('Error fetching family members:', e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// DOCTOR APIs
// ═══════════════════════════════════════════════════

// List active doctors at a hospital
app.get('/api/doctors', async (req, res) => {
  try {
    const { establishment_id } = req.query;
    let query = `
      SELECT d.id, d.name, d.email, d.specialization, d.qualification,
             d.experience_years, d.phone, d.photo_url, d.is_active,
             (SELECT COUNT(*) FROM patient_queue pq
              WHERE pq.doctor_id = d.id AND pq.status IN ('WAITING','IN_CONSULTATION')
              AND DATE(pq.queued_at) = CURRENT_DATE) AS queue_count
      FROM doctors d WHERE d.is_active = true
    `;
    const params = [];
    if (establishment_id) {
      params.push(establishment_id);
      query += ` AND d.establishment_id = $${params.length}`;
    }
    query += ` ORDER BY d.specialization, d.name`;

    const result = await pool.query(query, params);
    res.json({ doctors: result.rows });
  } catch (e) {
    console.error('Error fetching doctors:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get doctor profile by ID
app.get('/api/doctors/:doctorId', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const result = await pool.query(
      `SELECT d.*, e.name AS hospital_name
       FROM doctors d
       LEFT JOIN establishments e ON e.id = d.establishment_id
       WHERE d.id = $1`,
      [doctorId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Doctor not found' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Error fetching doctor:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get logged-in doctor's profile by auth user ID
app.get('/api/doctors/me/:authUserId', async (req, res) => {
  try {
    const { authUserId } = req.params;
    const result = await pool.query(
      `SELECT d.*, e.name AS hospital_name
       FROM doctors d
       LEFT JOIN establishments e ON e.id = d.establishment_id
       WHERE d.auth_user_id = $1`,
      [authUserId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Doctor profile not found' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Error fetching doctor profile:', e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// PATIENT QUEUE APIs
// ═══════════════════════════════════════════════════

// Employee adds patient to doctor's queue
app.post('/api/queue/add', async (req, res) => {
  try {
    const { doctor_id, family_member_id, family_id, establishment_id, added_by, notes, vitals } = req.body;

    if (!doctor_id || !family_member_id || !family_id) {
      return res.status(400).json({ error: 'doctor_id, family_member_id, and family_id are required' });
    }

    // Calculate token number (max token for this doctor today + 1)
    const tokenRes = await pool.query(
      `SELECT COALESCE(MAX(token_number), 0) + 1 AS next_token
       FROM patient_queue
       WHERE doctor_id = $1 AND DATE(queued_at) = CURRENT_DATE`,
      [doctor_id]
    );
    const tokenNumber = tokenRes.rows[0].next_token;

    const result = await pool.query(
      `INSERT INTO patient_queue (doctor_id, family_member_id, family_id, establishment_id, token_number, added_by, notes, vitals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [doctor_id, family_member_id, family_id, establishment_id || null, tokenNumber, added_by || null, notes || null, vitals ? JSON.stringify(vitals) : null]
    );

    // Fetch patient and doctor names for the response
    const patientRes = await pool.query(`SELECT name, relation FROM family_members WHERE id = $1`, [family_member_id]);
    const doctorRes = await pool.query(`SELECT name, specialization FROM doctors WHERE id = $1`, [doctor_id]);

    res.json({
      success: true,
      queue_entry: result.rows[0],
      token_number: tokenNumber,
      patient_name: patientRes.rows[0]?.name,
      doctor_name: doctorRes.rows[0]?.name,
      doctor_specialization: doctorRes.rows[0]?.specialization
    });
  } catch (e) {
    console.error('Error adding to queue:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get doctor's queue for a date
app.get('/api/queue/doctor/:doctorId', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT pq.*, fm.name AS patient_name, fm.relation, fm.gender, fm.date_of_birth,
              fm.blood_group, fm.allergies, fm.chronic_conditions,
              f.family_name, f.head_worker_id, pq.vitals AS intake_vitals
       FROM patient_queue pq
       JOIN family_members fm ON fm.id = pq.family_member_id
       JOIN families f ON f.id = pq.family_id
       WHERE pq.doctor_id = $1 AND DATE(pq.queued_at) = $2
       ORDER BY pq.token_number ASC`,
      [doctorId, date]
    );

    // Queue summary
    const waiting = result.rows.filter(r => r.status === 'WAITING').length;
    const inConsultation = result.rows.filter(r => r.status === 'IN_CONSULTATION').length;
    const completed = result.rows.filter(r => r.status === 'COMPLETED').length;

    res.json({
      queue: result.rows,
      summary: { total: result.rows.length, waiting, in_consultation: inConsultation, completed }
    });
  } catch (e) {
    console.error('Error fetching doctor queue:', e);
    res.status(500).json({ error: e.message });
  }
});

// Doctor updates queue status
app.patch('/api/queue/:queueId/status', async (req, res) => {
  try {
    const { queueId } = req.params;
    const { status } = req.body;

    const validStatuses = ['WAITING', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    let extraFields = '';
    if (status === 'IN_CONSULTATION') extraFields = ', called_at = NOW()';
    if (status === 'COMPLETED' || status === 'CANCELLED') extraFields = ', completed_at = NOW()';

    const result = await pool.query(
      `UPDATE patient_queue SET status = $1 ${extraFields} WHERE id = $2 RETURNING *`,
      [status, queueId]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Queue entry not found' });
    res.json({ success: true, queue_entry: result.rows[0] });
  } catch (e) {
    console.error('Error updating queue status:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get full patient profile for a queue entry
app.get('/api/queue/:queueId/patient-profile', async (req, res) => {
  try {
    const { queueId } = req.params;

    // Get queue entry with patient details
    const queueRes = await pool.query(
      `SELECT pq.*, fm.name AS patient_name, fm.relation, fm.gender, fm.date_of_birth,
              fm.blood_group, fm.allergies, fm.chronic_conditions, fm.phone AS patient_phone,
              f.family_name, f.head_worker_id, f.address AS family_address, f.district AS family_district,
              d.name AS doctor_name, d.specialization,
              pq.vitals AS intake_vitals
       FROM patient_queue pq
       JOIN family_members fm ON fm.id = pq.family_member_id
       JOIN families f ON f.id = pq.family_id
       JOIN doctors d ON d.id = pq.doctor_id
       WHERE pq.id = $1`,
      [queueId]
    );
    if (queueRes.rowCount === 0) return res.status(404).json({ error: 'Queue entry not found' });

    const entry = queueRes.rows[0];

    // Get past prescriptions for this patient
    const prescriptionsRes = await pool.query(
      `SELECT ep.*, d.name AS doctor_name, d.specialization
       FROM e_prescriptions ep
       JOIN doctors d ON d.id = ep.doctor_id
       WHERE ep.family_member_id = $1
       ORDER BY ep.created_at DESC LIMIT 20`,
      [entry.family_member_id]
    );

    // Get all family members
    const familyMembersRes = await pool.query(
      `SELECT id, name, relation, gender, date_of_birth, blood_group, allergies, chronic_conditions, phone
       FROM family_members WHERE family_id = $1 AND is_active = true
       ORDER BY CASE relation WHEN 'SELF' THEN 1 WHEN 'SPOUSE' THEN 2 WHEN 'FATHER' THEN 3
         WHEN 'MOTHER' THEN 4 WHEN 'SON' THEN 5 WHEN 'DAUGHTER' THEN 6 ELSE 7 END`,
      [entry.family_id]
    );

    // Get head worker details (card_uid, scheme, photo, etc.)
    let workerInfo = null;
    if (entry.head_worker_id) {
      const workerRes = await pool.query(
        `SELECT worker_id, first_name, last_name, phone, district, mandal, card_uid,
                photo_url, blood_group AS head_blood_group, scheme_name, gender AS head_gender,
                dob AS head_dob, aadhaar_number
         FROM workers WHERE id = $1`,
        [entry.head_worker_id]
      );
      if (workerRes.rowCount > 0) workerInfo = workerRes.rows[0];
    }

    // Get worker health records if family head
    let healthRecords = [];
    if (entry.head_worker_id) {
      const recordsRes = await pool.query(
        `SELECT hr.*, e.name AS hospital_name
         FROM hospital_records hr
         LEFT JOIN establishments e ON e.id = hr.establishment_id
         WHERE hr.worker_id = $1
         ORDER BY hr.created_at DESC LIMIT 20`,
        [entry.head_worker_id]
      );
      healthRecords = recordsRes.rows;
    }

    // Get past queue visits for this patient
    const pastVisitsRes = await pool.query(
      `SELECT pq.queued_at, pq.status, pq.notes, pq.token_number,
              d.name AS doctor_name, d.specialization
       FROM patient_queue pq
       JOIN doctors d ON d.id = pq.doctor_id
       WHERE pq.family_member_id = $1 AND pq.id != $2
       ORDER BY pq.queued_at DESC LIMIT 10`,
      [entry.family_member_id, queueId]
    );

    res.json({
      patient: entry,
      prescriptions: prescriptionsRes.rows,
      health_records: healthRecords,
      family_members: familyMembersRes.rows,
      worker_info: workerInfo,
      past_visits: pastVisitsRes.rows
    });
  } catch (e) {
    console.error('Error fetching patient profile:', e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// E-PRESCRIPTION APIs
// ═══════════════════════════════════════════════════

// Doctor creates e-prescription
app.post('/api/prescriptions', async (req, res) => {
  try {
    const { queue_id, doctor_id, family_member_id, establishment_id,
            diagnosis, symptoms, vitals, medicines, tests_recommended, advice, follow_up_date } = req.body;

    if (!doctor_id || !family_member_id) {
      return res.status(400).json({ error: 'doctor_id and family_member_id are required' });
    }

    const result = await pool.query(
      `INSERT INTO e_prescriptions (queue_id, doctor_id, family_member_id, establishment_id,
         diagnosis, symptoms, vitals, medicines, tests_recommended, advice, follow_up_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [queue_id || null, doctor_id, family_member_id, establishment_id || null,
       diagnosis, symptoms, vitals ? JSON.stringify(vitals) : null,
       medicines ? JSON.stringify(medicines) : null, tests_recommended, advice, follow_up_date || null]
    );

    // If queue_id provided, mark queue entry as COMPLETED
    if (queue_id) {
      await pool.query(
        `UPDATE patient_queue SET status = 'COMPLETED', completed_at = NOW() WHERE id = $1`,
        [queue_id]
      );
    }

    res.json({ success: true, prescription: result.rows[0] });
  } catch (e) {
    console.error('Error creating prescription:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get all prescriptions for a patient
app.get('/api/prescriptions/patient/:familyMemberId', async (req, res) => {
  try {
    const { familyMemberId } = req.params;
    const result = await pool.query(
      `SELECT ep.*, d.name AS doctor_name, d.specialization, e.name AS hospital_name
       FROM e_prescriptions ep
       JOIN doctors d ON d.id = ep.doctor_id
       LEFT JOIN establishments e ON e.id = ep.establishment_id
       WHERE ep.family_member_id = $1
       ORDER BY ep.created_at DESC`,
      [familyMemberId]
    );
    res.json({ prescriptions: result.rows });
  } catch (e) {
    console.error('Error fetching prescriptions:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get single prescription by ID
app.get('/api/prescriptions/:prescriptionId', async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const result = await pool.query(
      `SELECT ep.*, d.name AS doctor_name, d.specialization, d.qualification,
              e.name AS hospital_name, fm.name AS patient_name, fm.gender, fm.date_of_birth,
              fm.blood_group, fm.allergies, fm.chronic_conditions
       FROM e_prescriptions ep
       JOIN doctors d ON d.id = ep.doctor_id
       LEFT JOIN establishments e ON e.id = ep.establishment_id
       JOIN family_members fm ON fm.id = ep.family_member_id
       WHERE ep.id = $1`,
      [prescriptionId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Prescription not found' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Error fetching prescription:', e);
    res.status(500).json({ error: e.message });
  }
});

// HTTPS Setup (Conditional for Local Dev - Vercel handles HTTPS automatically)
let httpsOptions = {};
try {
  httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, '../key.pem')),
    cert: fs.readFileSync(path.join(__dirname, '../cert.pem'))
  };
} catch (e) { }

if (process.env.VERCEL) {
  console.log('Running in Vercel environment (Serverless)');
} else {
  // Local Dev
  if (httpsOptions.key) {
    https.createServer(httpsOptions, app).listen(PORT, () => {
      console.log(`SECURE Server listening on port ${PORT}`);
    });
  } else {
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT} (HTTP only)`);
    });
  }
}

export default app;
