
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

  return { rpID, origin: origin || `http://${rpID}:5173` };
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
          (worker_id, first_name, last_name, state, district, is_active)
          VALUES ($1, $2, $3, 'Telangana', 'Hyderabad', true)
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

async function updateCheckStatus(username, status, location = 'Unknown') {
  const timestamp = new Date().toISOString();

  // 1. Find Worker UUID from worker_id (username)
  const workerRes = await pool.query('SELECT id FROM workers WHERE worker_id = $1', [username]);
  const worker = workerRes.rows[0];

  if (!worker) {
    console.warn(`Worker profile not found for ${username}. Authentication successful but attendance NOT recorded.`);
    return; // Or throw error?
  }

  // 2. Find mapped Establishment
  const mappingRes = await pool.query(
    'SELECT establishment_id FROM worker_mappings WHERE worker_id = $1 AND is_active = true',
    [worker.id]
  );
  const establishmentId = mappingRes.rows[0]?.establishment_id || null;

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
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: origin,
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
  const { username } = req.body;
  let allowCredentials = [];
  let user;

  if (username) {
    user = await getOrCreateUser(username);
    const authenticators = await getUserAuthenticators(username);
    allowCredentials = authenticators.map(dev => ({
      id: isoBase64URL.fromBuffer(dev.credentialID),
      type: 'public-key',
      transports: dev.transports,
    }));
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
  const { username, body, action, location } = req.body;
  let user;
  let currentChallenge;

  try {
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
    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: currentChallenge,
      expectedOrigin: origin,
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

      if (action === 'toggle') {
        const check = await getCheckStatus(user.username);
        status = check.status === 'out' ? 'in' : 'out';
        await updateCheckStatus(user.username, status, location);
        message = status === 'in' ? `Welcome back ${user.username}! Checked In.` : `Goodbye ${user.username}! Checked Out.`;
      }

      res.json({ verified: true, status, message, username: user.username });
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
