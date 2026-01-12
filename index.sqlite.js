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
import Database from 'better-sqlite3';
import https from 'https';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// Initialize SQLite
const db = new Database('fido.db', { verbose: console.log });
db.pragma('journal_mode = WAL');

// Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    id BLOB NOT NULL,
    currentChallenge TEXT
  );
  
  CREATE TABLE IF NOT EXISTS authenticators (
    credentialID BLOB NOT NULL PRIMARY KEY,
    username TEXT NOT NULL,
    credentialPublicKey BLOB NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT,
    FOREIGN KEY(username) REFERENCES users(username)
  );

  CREATE TABLE IF NOT EXISTS checks (
    username TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    timestamp TEXT,
    FOREIGN KEY(username) REFERENCES users(username)
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    location TEXT,
    FOREIGN KEY(username) REFERENCES users(username)
  );

  CREATE TABLE IF NOT EXISTS stations (
    name TEXT PRIMARY KEY,
    description TEXT,
    created_at TEXT
  );
`);
// Migration: Ensure location column exists
try {
  db.prepare('ALTER TABLE audit_logs ADD COLUMN location TEXT').run();
} catch (e) {
  // Column likely exists
}

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
  // Convert buffer to Base64URL string
  fromBuffer: (buffer) => {
    if (!buffer) return '';
    const base64 = Buffer.from(buffer).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  },
  // Convert Base64URL string to Buffer
  toBuffer: (base64url) => {
    if (!base64url) return Buffer.alloc(0);
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64');
  }
}


// --- DB HELPERS ---
function getOrCreateUser(username) {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  let user = stmt.get(username);

  if (!user) {
    const userId = crypto.randomBytes(16); // Buffer
    const insert = db.prepare('INSERT INTO users (username, id) VALUES (?, ?)');
    insert.run(username, userId);
    user = { username, id: userId, currentChallenge: null };

    // Init check status
    const insertCheck = db.prepare('INSERT INTO checks (username, status) VALUES (?, ?)');
    insertCheck.run(username, 'out');
  }
  return user;
}

function getUserAuthenticators(username) {
  const stmt = db.prepare('SELECT * FROM authenticators WHERE username = ?');
  const rows = stmt.all(username);
  return rows.map(row => ({
    credentialID: row.credentialID, // BLOB -> Buffer
    credentialPublicKey: row.credentialPublicKey, // BLOB -> Buffer
    counter: row.counter,
    transports: JSON.parse(row.transports || '[]')
  }));
}

function saveAuthenticator(username, authenticator) {
  const stmt = db.prepare(`
        INSERT INTO authenticators (credentialID, username, credentialPublicKey, counter, transports)
        VALUES (?, ?, ?, ?, ?)
    `);
  stmt.run(
    authenticator.credentialID, // Buffer
    username,
    authenticator.credentialPublicKey, // Buffer
    authenticator.counter,
    JSON.stringify(authenticator.transports)
  );
}

function updateAuthenticatorCounter(credentialID, newCounter) {
  const stmt = db.prepare('UPDATE authenticators SET counter = ? WHERE credentialID = ?');
  stmt.run(newCounter, credentialID); // credentialID is Buffer
}

function getCheckStatus(username) {
  const stmt = db.prepare('SELECT status, timestamp FROM checks WHERE username = ?');
  return stmt.get(username) || { status: 'out', timestamp: null };
}

function updateCheckStatus(username, status, location = null) {
  const timestamp = new Date().toISOString();

  // Update current status
  const stmt = db.prepare('INSERT OR REPLACE INTO checks (username, status, timestamp) VALUES (?, ?, ?)');
  stmt.run(username, status, timestamp);

  // Add to audit log
  const logStmt = db.prepare('INSERT INTO audit_logs (username, action, timestamp, location) VALUES (?, ?, ?, ?)');
  logStmt.run(username, status, timestamp, location);
}

function updateUserChallenge(username, challenge) {
  const stmt = db.prepare('UPDATE users SET currentChallenge = ? WHERE username = ?');
  stmt.run(challenge, username);
}

// --- ENDPOINTS ---

app.get('/', (req, res) => { res.send('FIDO Server Running (SQLite)'); });


// REGISTRATION
app.post('/api/register/begin', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const user = getOrCreateUser(username);
    const rpConfig = getRpConfig(req);

    // Get ALL existing credentials to prevent duplicate card registration globally (One Card = One Person)
    const allAuthenticators = db.prepare('SELECT * FROM authenticators').all().map(row => ({
      credentialID: row.credentialID,
      transports: JSON.parse(row.transports || '[]')
    }));

    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpConfig.rpID || 'localhost',
      userID: new Uint8Array(user.id),
      userName: user.username,
      attestationType: 'direct', // Request full hardware details to check for Serial Number
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

    updateUserChallenge(username, options.challenge);
    res.json(options);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/register/finish', async (req, res) => {
  const { username, body } = req.body;
  const user = getOrCreateUser(username); // Refetch to be sure

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
      console.log('---------------------------------------------------');
      console.log('[REGISTER] DIRECT ATTESTATION DATA (Checking for Serial/BN):');
      console.log(JSON.stringify(registrationInfo, (key, value) => {
        if (value instanceof Uint8Array || (typeof value === 'object' && value && value.type === 'Buffer')) {
          return Buffer.from(value).toString('hex');
        }
        return value;
      }, 2));
      console.log('---------------------------------------------------');

      // SimpleWebAuthn v10+ fix: properties might be nested
      let { credentialPublicKey, credentialID, counter } = registrationInfo;

      // Try nested credential object
      if (!credentialID && registrationInfo.credential) {
        // Sometimes registrationInfo.credential IS the ID buffer if unstructured? No, usually object.
        if (registrationInfo.credential.id) {
          credentialID = registrationInfo.credential.id;
        }
        if (registrationInfo.credential.publicKey) {
          credentialPublicKey = registrationInfo.credential.publicKey;
        }
        if (registrationInfo.credential.counter) {
          counter = registrationInfo.credential.counter;
        }

        // Also check if 'credential' has 'credentialID' property
        if (!credentialID && registrationInfo.credential.credentialID) {
          credentialID = registrationInfo.credential.credentialID;
        }
      }

      // If still missing but we have 'credential' object with different structure, log it above

      if (!credentialID) throw new Error('credentialID is null');

      // FIX: credential.id is often a Base64URL String from the library, not a Buffer.
      // If we store Buffer.from(string), we get ASCII bytes of the string, which is wrong.
      // We must DECODE it.
      let credIdBuffer;
      if (typeof credentialID === 'string') {
        credIdBuffer = isoBase64URL.toBuffer(credentialID);
      } else {
        credIdBuffer = Buffer.from(credentialID);
      }

      console.log(`[REGISTER] Attempting to register Credential ID (Hex): ${credIdBuffer.toString('hex')}`);

      let aaguidHex = 'unknown';
      if (registrationInfo.aaguid) {
        aaguidHex = Buffer.from(registrationInfo.aaguid).toString('hex');
        console.log(`[REGISTER] Device AAGUID: ${aaguidHex}`);
      }

      // Check if credential ID already exists in DB
      const existingAuth = db.prepare('SELECT * FROM authenticators WHERE credentialID = ?').get(credIdBuffer);
      if (existingAuth) {
        console.log('[REGISTER] BLOCKED: Credential ID collision.');
        throw new Error('This card is already registered to a user.');
      } else {
        console.log('[REGISTER] Credential ID is unique. Proceeding.');
      }

      const pubKeyBuffer = Buffer.from(credentialPublicKey);

      saveAuthenticator(username, {
        credentialID: credIdBuffer,
        credentialPublicKey: pubKeyBuffer,
        counter,
        transports: body.response.transports
      });

      updateUserChallenge(username, null);
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
    user = getOrCreateUser(username);
    const authenticators = getUserAuthenticators(username);
    allowCredentials = authenticators.map(dev => ({
      id: isoBase64URL.fromBuffer(dev.credentialID),
      type: 'public-key',
      transports: dev.transports,
    }));
  }

  const { rpID } = getRpConfig(req);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials, // Empty for resident key search
    userVerification: 'preferred',
  });

  // If username provided, save challenge to that user. 
  // If NOT provided, we need to store challenge globally or temporarily?
  // For simplicity in this mock, we can store it in a temporary "pending challenges" map 
  // keyed by the challenge itself, or if we want to be stateless, use a signed cookie.
  // BUT: SimpleWebAuthn requires checking challenge against user.
  // Let's store it in a special "global_challenges" map for usernameless.

  if (user) {
    updateUserChallenge(username, options.challenge);
  } else {
    // Store in a global cache for usernameless flow
    // In production use Redis. Here: Map.
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
      user = getOrCreateUser(username);
      currentChallenge = user.currentChallenge;
    } else {
      // Usernameless: browser response should contain userHandle
      const response = body.response;
      if (!response.userHandle) {
        throw new Error('User handle missing in response (not a discoverable credential?)');
      }
      // userHandle is usually base64url string from browser? No, it's string in simplewebauthn result?
      // Browser returns it as property. SimpleWebAuthn types it.
      // In raw webauthn it is buffer. SimpleWebAuthn normalizes?
      // Let's assume body.response.userHandle is string (base64url).

      // We stored user.id as BLOB (Buffer) in SQLite. 
      // We need to find user by ID.
      const userHandleBuffer = isoBase64URL.toBuffer(response.userHandle);

      const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
      user = stmt.get(userHandleBuffer);

      if (!user) throw new Error('User not found from userHandle');

      // For challenge, we look in pendingChallenges using the one returned in clientDataJSON? 
      // But verification needs EXPECTED challenge.
      // We can't trust client to send expected challenge.
      // But wait, in usernameless, we don't know who is trying until they send response.
      // So we must have stored the challenge somewhere.
      // The browser repeats the challenge in clientDataJSON. We verify signature matches it.
      // But we need to verify THE CHALLENGE was one WE issued.
      // So we check our pending set.

      const clientData = JSON.parse(Buffer.from(body.response.clientDataJSON, 'base64url').toString('utf8'));
      const returnedChallenge = clientData.challenge;

      if (pendingChallenges.has(returnedChallenge)) {
        currentChallenge = returnedChallenge;
        pendingChallenges.delete(returnedChallenge);
      } else {
        throw new Error('Challenge not found or expired');
      }
    }

    // ... match credential
    const authenticators = getUserAuthenticators(user.username);
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
        counter: dbAuthenticator.counter || 0, // FIX: Ensure 0 if null
        transports: dbAuthenticator.transports,
      },
    });

    const { verified, authenticationInfo } = verification;

    if (verified) {
      updateAuthenticatorCounter(dbAuthenticator.credentialID, authenticationInfo.newCounter);
      if (username) updateUserChallenge(username, null);

      let status = 'out';
      let message = 'Authenticated';

      if (action === 'toggle') {
        const check = getCheckStatus(user.username);
        status = check.status === 'out' ? 'in' : 'out';
        updateCheckStatus(user.username, status, location);
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
app.get('/api/admin/data', (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  const checks = db.prepare('SELECT * FROM checks').all();
  const auths = db.prepare('SELECT username, counter, credentialID FROM authenticators').all();

  // Merge data
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
});

// ADMIN - AUDIT LOGS
app.get('/api/admin/audit/:username', (req, res) => {
  const { username } = req.params;
  try {
    const stmt = db.prepare('SELECT * FROM audit_logs WHERE username = ? ORDER BY timestamp DESC LIMIT 50');
    const logs = stmt.all(username);
    res.json(logs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ADMIN - EXPORT
app.get('/api/admin/export', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC').all();
    res.json(logs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});




// DELETE USER
app.delete('/api/admin/user/:username', (req, res) => {
  const { username } = req.params;
  try {
    db.prepare('DELETE FROM authenticators WHERE username = ?').run(username);
    db.prepare('DELETE FROM checks WHERE username = ?').run(username);
    db.prepare('DELETE FROM audit_logs WHERE username = ?').run(username);
    const info = db.prepare('DELETE FROM users WHERE username = ?').run(username);

    if (info.changes > 0) {
      res.json({ success: true, message: `User ${username} deleted.` });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// STATUS
app.get('/api/status/:username', (req, res) => {
  const { username } = req.params;
  res.json(getCheckStatus(username));
});

// STATIONS
app.get('/api/admin/stations', (req, res) => {
  try {
    const stations = db.prepare('SELECT * FROM stations ORDER BY created_at DESC').all();
    res.json(stations);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/stations', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Station Name required' });
  try {
    db.prepare('INSERT INTO stations (name, description, created_at) VALUES (?, ?, ?)').run(name, description, new Date().toISOString());
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE constraint')) return res.status(409).json({ error: 'Station name already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/stations/:name', (req, res) => {
  const { name } = req.params;
  try {
    db.prepare('DELETE FROM stations WHERE name = ?').run(name);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const httpsOptions = {
  key: fs.readFileSync(path.join(process.cwd(), '../key.pem')),
  cert: fs.readFileSync(path.join(process.cwd(), '../cert.pem'))
};

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`SECURE Server listening on port ${PORT}`);
});
