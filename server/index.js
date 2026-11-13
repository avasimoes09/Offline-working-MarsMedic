import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import {
  clearLoginSessions,
  createPatient,
  database,
  findPatientsByPin,
  findPatientByUsername,
  findPatientById,
  readAppSetting,
  readPatient,
  updatePatientHealth,
  updatePatientPin,
  verifyPin,
  writeAppSetting,
} from './secureStore.js';

const PORT = process.env.API_PORT === '0' ? 0 : Number(process.env.API_PORT || 8787);
const LAN_HOST = process.env.LAN_HOST?.trim().toLowerCase();
const HOST = (process.env.API_HOST || '127.0.0.1').toLowerCase();
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];
const ipv4Parts = LAN_HOST && isIP(LAN_HOST) === 4 ? LAN_HOST.split('.').map(Number) : [];
const isPrivateIpv4 = ipv4Parts.length === 4 && (
  ipv4Parts[0] === 10 ||
  (ipv4Parts[0] === 172 && ipv4Parts[1] >= 16 && ipv4Parts[1] <= 31) ||
  (ipv4Parts[0] === 192 && ipv4Parts[1] === 168) ||
  (ipv4Parts[0] === 169 && ipv4Parts[1] === 254)
);
const isLocalHostname = Boolean(LAN_HOST && (LAN_HOST.endsWith('.local') || LAN_HOST.endsWith('.lan')));
const isLanHost = Boolean(LAN_HOST && (isPrivateIpv4 || isLocalHostname));
if (LAN_HOST && !isLanHost) throw new Error('LAN_HOST must be a private IPv4 address or a .local/.lan hostname.');
if (!LAN_HOST && !LOOPBACK_HOSTS.includes(HOST)) throw new Error('Set LAN_HOST before binding the service to a network interface.');
if (LAN_HOST && !LOOPBACK_HOSTS.includes(HOST) && HOST !== LAN_HOST) {
  throw new Error('API_HOST must be localhost or match LAN_HOST.');
}
const tlsCertPath = process.env.TLS_CERT_PATH;
const tlsKeyPath = process.env.TLS_KEY_PATH;
if (HOST === LAN_HOST && (!tlsCertPath || !tlsKeyPath)) {
  throw new Error('TLS_CERT_PATH and TLS_KEY_PATH are required when the API is exposed on the LAN.');
}
const tlsOptions = HOST === LAN_HOST
  ? { cert: readFileSync(tlsCertPath), key: readFileSync(tlsKeyPath) }
  : null;
const SESSION_MS = 12 * 60 * 60 * 1000;
const challenges = new Map();
const attempts = new Map();
const profileFields = [
  'dateOfBirth', 'bloodType', 'heartRate', 'bloodPressure', 'temperature',
  'oxygenSaturation', 'respiratoryRate', 'allergies', 'medications',
  'medicalHistory', 'notes',
];
const mimeTypes = {
  '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 64 * 1024) throw new Error('Request is too large.');
  }
  return raw ? JSON.parse(raw) : {};
}

function cookieValue(request, name) {
  const item = (request.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

function sessionCookie(token, maxAge = SESSION_MS / 1000) {
  const secure = LAN_HOST ? '; Secure' : '';
  return `marsmedic_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function createSession(response, patientId) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = Date.now() + SESSION_MS;
  const startedAt = new Date().toISOString();
  database.prepare('INSERT INTO sessions (token_hash, patient_id, started_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, patientId, startedAt, expiresAt);
  response.setHeader('Set-Cookie', sessionCookie(token));
  return startedAt;
}

function currentPatient(request) {
  const token = cookieValue(request, 'marsmedic_session');
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = database.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, Date.now());
  if (!session) return null;
  const patient = findPatientById(session.patient_id);
  return patient ? { patient, tokenHash, startedAt: session.started_at } : null;
}

function publicProfile(patient) {
  const profile = readPatient(patient);
  const passkeyCount = database.prepare('SELECT COUNT(*) AS count FROM passkeys WHERE patient_id = ?').get(patient.id).count;
  return {
    ...profile,
    conditions: Array.isArray(profile.conditions) ? profile.conditions : [],
    medicalHistoryEntries: Array.isArray(profile.medicalHistoryEntries) ? profile.medicalHistoryEntries : [],
    assessmentHistory: Array.isArray(profile.assessmentHistory) ? profile.assessmentHistory : [],
    wellnessEntries: Array.isArray(profile.wellnessEntries) ? profile.wellnessEntries : [],
    hasPasskey: passkeyCount > 0,
  };
}

function pinOkay(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

function normalizeProfile(body) {
  return Object.fromEntries(profileFields.map((field) => [field, String(body[field] || '').trim().slice(0, 2000)]));
}

function attemptKey(username, request) {
  return `${String(username).trim().toLowerCase()}:${request.socket.remoteAddress || 'local'}`;
}

function blocked(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.until <= Date.now()) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= 5;
}

function failedAttempt(key) {
  const entry = attempts.get(key) || { count: 0, until: Date.now() + 15 * 60 * 1000 };
  entry.count += 1;
  attempts.set(key, entry);
}

function requestOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) throw new Error('Missing request origin.');
  const url = new URL(origin);
  if (LAN_HOST) {
    const requestHost = request.headers.host?.toLowerCase();
    if (url.protocol !== 'https:' || url.hostname !== LAN_HOST || url.host !== requestHost) {
      throw new Error('This LAN service only accepts secure same-origin app requests.');
    }
    return { origin, rpID: url.hostname };
  }
  const isLocalHost = LOOPBACK_HOSTS.includes(url.hostname);
  const forwardedDevelopmentHost = process.env.NODE_ENV !== 'production' &&
    (url.hostname.endsWith('.app.github.dev') || url.hostname.endsWith('.github.dev'));
  if (!isLocalHost && !forwardedDevelopmentHost) throw new Error('This local service only accepts same-device app requests.');
  return { origin, rpID: url.hostname };
}

function consumeChallenge(challenge, purpose, patientId) {
  const entry = challenges.get(challenge);
  challenges.delete(challenge);
  const patientMatches = entry?.patientId === patientId || (purpose === 'login' && entry?.patientId === null);
  return entry && entry.purpose === purpose && patientMatches && entry.expiresAt > Date.now();
}

function pruneExpiredChallenges() {
  const now = Date.now();
  for (const [challenge, entry] of challenges) {
    if (entry.expiresAt <= now) challenges.delete(challenge);
  }
}

function logSession(patient, body) {
  const profile = readPatient(patient);
  const entries = Array.isArray(body.entries) ? body.entries.slice(-100).map((entry) => ({
    type: String(entry.type || 'Session note').slice(0, 80),
    details: String(entry.details || '').slice(0, 1000),
    at: String(entry.at || new Date().toISOString()).slice(0, 40),
  })).filter((entry) => entry.details.trim()) : [];
  if (!entries.length) return;

  profile.medicalHistoryEntries = [
    ...(profile.medicalHistoryEntries || []),
    {
      type: 'Session summary',
      startedAt: String(body.startedAt || '').slice(0, 40),
      endedAt: new Date().toISOString(),
      entries,
    },
  ].slice(-500);
  updatePatientHealth(patient.id, profile);
}

function validateInventory(body) {
  const source = body?.inventory;
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || !Array.isArray(source.medicalItems) || !Array.isArray(source.foodItems)
    || source.medicalItems.length > 1000 || source.foodItems.length > 1000) return null;

  const normalizeItems = (items) => items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const name = String(item.name || '').trim().slice(0, 200);
    const quantity = Number(item.quantity);
    if (!name || !Number.isFinite(quantity) || quantity < 0) return null;
    return {
      id: String(item.id || randomBytes(12).toString('hex')).slice(0, 100),
      name,
      quantity,
      unit: String(item.unit || '').slice(0, 40),
      description: String(item.description || '').slice(0, 1000),
      usage: String(item.usage || '').slice(0, 1000),
      low_threshold: Number.isFinite(Number(item.low_threshold)) ? Math.max(0, Number(item.low_threshold)) : null,
    };
  });
  const medicalItems = normalizeItems(source.medicalItems);
  const foodItems = normalizeItems(source.foodItems);
  return medicalItems.includes(null) || foodItems.includes(null) ? null : { medicalItems, foodItems };
}

function normalizeAssessment(body, id) {
  const strings = (value, limit = 100) => (
    Array.isArray(value) ? value.slice(0, limit).filter((item) => typeof item === 'string').map((item) => item.slice(0, 500)) : []
  );
  if (!body || typeof body !== 'object' || !Array.isArray(body.symptoms)
    || !Array.isArray(body.candidates) || body.candidates.length > 20) return null;
  const candidates = body.candidates.map((candidate) => {
    if (!candidate || typeof candidate.name !== 'string' || typeof candidate.id !== 'string') return null;
    const score = Number(candidate.matchScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
    return {
      id: candidate.id.slice(0, 200),
      name: candidate.name.slice(0, 200),
      severity: String(candidate.severity || 'UNASSESSED').slice(0, 40),
      matchScore: score,
      source: String(candidate.source || '').slice(0, 100),
      matched: strings(candidate.matched),
      evidence: strings(candidate.evidence, 50),
      treatment: strings(candidate.treatment, 20),
      sampleCount: Number.isFinite(Number(candidate.sampleCount)) ? Number(candidate.sampleCount) : null,
    };
  });
  if (candidates.includes(null)) return null;
  const selectedCandidateId = String(body.selectedCandidateId || '');
  if (selectedCandidateId && !candidates.some((candidate) => candidate.id === selectedCandidateId)) return null;
  return {
    id,
    assessedAt: String(body.assessedAt || new Date().toISOString()).slice(0, 40),
    symptoms: strings(body.symptoms),
    candidates,
    selectedCandidateId,
    vitals: body.vitals && typeof body.vitals === 'object' && !Array.isArray(body.vitals)
      ? Object.fromEntries(Object.entries(body.vitals).slice(0, 20).map(([key, value]) => [String(key).slice(0, 80), String(value).slice(0, 200)]))
      : {},
    rejected: strings(body.rejected),
  };
}

function validateWellnessEntry(body) {
  if (!body || !['Sleep', 'Nutrition'].includes(body.type) || !body.details || typeof body.details !== 'object' || Array.isArray(body.details)) return null;
  const details = body.details;
  const logDate = String(details.log_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) return null;
  if (body.type === 'Sleep') {
    const hours = Number(details.hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) return null;
    return {
      id: randomBytes(16).toString('hex'),
      type: 'Sleep',
      at: new Date().toISOString(),
      details: {
        log_date: logDate,
        sleep_time: String(details.sleep_time || '').slice(0, 5),
        wake_time: String(details.wake_time || '').slice(0, 5),
        hours,
      },
    };
  }
  const foodName = String(details.food_name || '').trim();
  const amount = Number(details.amount);
  if (!foodName || foodName.length > 200 || !Number.isFinite(amount) || amount <= 0) return null;
  return {
    id: randomBytes(16).toString('hex'),
    type: 'Nutrition',
    at: new Date().toISOString(),
    details: {
      log_date: logDate,
      food_name: foodName,
      amount,
      unit: String(details.unit || '').slice(0, 40),
    },
  };
}

function contentType(filePath) {
  return mimeTypes[path.extname(filePath)] || 'application/octet-stream';
}

function serveStatic(request, response) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  if (!existsSync(path.join(root, 'index.html'))) return json(response, 503, { error: 'Build the app first with npm run build.' });
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const requested = path.resolve(root, `.${pathname}`);
  const isSafeFile = requested.startsWith(`${root}${path.sep}`) && existsSync(requested) && !requested.endsWith(path.sep);
  const filePath = isSafeFile
    ? requested
    : path.join(root, 'index.html');
  response.writeHead(200, {
    'Content-Type': contentType(filePath),
    'X-Content-Type-Options': 'nosniff',
    ...(path.extname(filePath) === '.zip' ? { 'Content-Disposition': `attachment; filename="${path.basename(filePath)}"` } : {}),
  });
  createReadStream(filePath).pipe(response);
}

async function handle(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (LAN_HOST && url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    try {
      requestOrigin(request);
    } catch (error) {
      return json(response, 403, { error: error.message });
    }
  }
  if (!url.pathname.startsWith('/api/')) return serveStatic(request, response);

  try {
    if (request.method === 'POST' && url.pathname === '/api/auth/register') {
      const body = await readBody(request);
      const name = String(body.name || '').trim().slice(0, 100);
      if (!name || !pinOkay(body.pin)) {
        return json(response, 400, { error: 'Enter a name and four-digit PIN.' });
      }
      if (findPatientsByPin(body.pin).length) return json(response, 409, { error: 'That PIN is already in use. Choose a different four-digit PIN.' });
      const id = randomBytes(16).toString('hex');
      const healthData = { ...normalizeProfile(body), conditions: [], medicalHistoryEntries: [] };
      createPatient({ id, username: id, name, pin: body.pin, healthData });
      const startedAt = createSession(response, id);
      return json(response, 201, { profile: publicProfile(findPatientById(id)), startedAt });
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/login-pin') {
      const body = await readBody(request);
      const key = attemptKey('pin', request);
      if (blocked(key)) return json(response, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      const matches = pinOkay(body.pin) ? findPatientsByPin(body.pin) : [];
      if (matches.length !== 1) {
        failedAttempt(key);
        return json(response, 401, { error: 'PIN is incorrect or is shared by multiple accounts.' });
      }
      attempts.delete(key);
      const [patient] = matches;
      const startedAt = createSession(response, patient.id);
      return json(response, 200, { profile: publicProfile(patient), startedAt });
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/me') {
      const auth = currentPatient(request);
      return auth ? json(response, 200, { profile: publicProfile(auth.patient), startedAt: auth.startedAt }) : json(response, 401, { error: 'Sign in required.' });
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      const auth = currentPatient(request);
      if (auth) {
        logSession(auth.patient, await readBody(request));
        database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(auth.tokenHash);
      }
      return json(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }

    if (request.method === 'GET' && url.pathname === '/api/inventory') {
      return json(response, 200, { inventory: readAppSetting('inventory') });
    }

    if (request.method === 'PUT' && url.pathname === '/api/inventory') {
      const inventory = validateInventory(await readBody(request));
      if (!inventory) return json(response, 400, { error: 'Provide valid medical and food inventory lists.' });
      writeAppSetting('inventory', inventory);
      return json(response, 200, { inventory });
    }

    if (request.method === 'GET' && url.pathname === '/api/settings/temperature-unit') {
      return json(response, 200, { temperatureUnit: readAppSetting('temperature-unit') || 'C' });
    }

    if (request.method === 'PUT' && url.pathname === '/api/settings/temperature-unit') {
      const { temperatureUnit } = await readBody(request);
      if (temperatureUnit !== 'C' && temperatureUnit !== 'F') {
        return json(response, 400, { error: 'Temperature unit must be C or F.' });
      }
      writeAppSetting('temperature-unit', temperatureUnit);
      return json(response, 200, { temperatureUnit });
    }

    if (request.method === 'POST' && url.pathname === '/api/assessment-history') {
      const auth = currentPatient(request);
      if (!auth) return json(response, 401, { error: 'Sign in to save assessment history.' });
      const body = await readBody(request);
      const id = typeof body.id === 'string' ? body.id.slice(0, 100) : '';
      if (!id) return json(response, 400, { error: 'An assessment identifier is required.' });
      const assessment = normalizeAssessment(body, id);
      if (!assessment) return json(response, 400, { error: 'Provide valid assessment symptoms and candidates.' });
      const profile = readPatient(auth.patient);
      const assessments = Array.isArray(profile.assessmentHistory) ? profile.assessmentHistory : [];
      const index = assessments.findIndex((entry) => entry.id === id);
      if (index >= 0) assessments[index] = assessment;
      else assessments.push(assessment);
      profile.assessmentHistory = assessments.slice(-500);
      updatePatientHealth(auth.patient.id, profile);
      return json(response, 200, { assessment, assessmentHistory: profile.assessmentHistory });
    }

    if (request.method === 'POST' && url.pathname === '/api/wellness-entries') {
      const auth = currentPatient(request);
      if (!auth) return json(response, 401, { error: 'Sign in to save patient wellness history.' });
      const entry = validateWellnessEntry(await readBody(request));
      if (!entry) return json(response, 400, { error: 'Provide a valid sleep or food entry.' });
      const profile = readPatient(auth.patient);
      profile.wellnessEntries = [...(Array.isArray(profile.wellnessEntries) ? profile.wellnessEntries : []), entry].slice(-1000);
      updatePatientHealth(auth.patient.id, profile);
      return json(response, 201, { entry, wellnessEntries: profile.wellnessEntries });
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/wellness-entries/')) {
      const auth = currentPatient(request);
      if (!auth) return json(response, 401, { error: 'Sign in to edit patient wellness history.' });
      const id = decodeURIComponent(url.pathname.slice('/api/wellness-entries/'.length));
      const profile = readPatient(auth.patient);
      profile.wellnessEntries = (Array.isArray(profile.wellnessEntries) ? profile.wellnessEntries : [])
        .filter((entry) => entry.id !== id);
      updatePatientHealth(auth.patient.id, profile);
      return json(response, 200, { wellnessEntries: profile.wellnessEntries });
    }

    if (request.method === 'PUT' && url.pathname === '/api/profile') {
      const auth = currentPatient(request);
      if (!auth) return json(response, 401, { error: 'Sign in required.' });
      const body = await readBody(request);
      const profile = readPatient(auth.patient);
      const name = String(body.name || auth.patient.name).trim().slice(0, 100);
      if (!name) return json(response, 400, { error: 'Name cannot be empty.' });
      const healthData = {
        ...profile,
        ...normalizeProfile(body),
        conditions: Array.isArray(body.conditions) ? body.conditions.slice(-200) : (profile.conditions || []),
        medicalHistoryEntries: Array.isArray(body.medicalHistoryEntries)
          ? body.medicalHistoryEntries.slice(-500)
          : (profile.medicalHistoryEntries || []),
      };
      delete healthData.id;
      delete healthData.name;
      database.prepare('UPDATE patients SET name = ? WHERE id = ?').run(name, auth.patient.id);
      updatePatientHealth(auth.patient.id, healthData);
      return json(response, 200, { profile: publicProfile(findPatientById(auth.patient.id)) });
    }

    if (request.method === 'POST' && url.pathname === '/api/device-readings') {
      const auth = currentPatient(request);
      if (!auth) return json(response, 401, { error: 'Sign in required.' });
      const body = await readBody(request);
      const fieldsByType = {
        vitals: ['hr', 'spo2', 'bpSys', 'bpDia', 'temp'],
        environmental: ['temperatureC', 'humidity', 'pressureKpa', 'co2Ppm'],
      };
      const fields = fieldsByType[body.type];
      if (!fields || typeof body.source !== 'string' || !body.source.trim() || !body.readings || typeof body.readings !== 'object' || Array.isArray(body.readings)) {
        return json(response, 400, { error: 'Provide a supported device type, source, and readings.' });
      }
      const readings = Object.fromEntries(fields
        .filter((field) => typeof body.readings[field] === 'number' && Number.isFinite(body.readings[field]))
        .map((field) => [field, body.readings[field]]));
      if (!Object.keys(readings).length) return json(response, 400, { error: 'At least one finite device reading is required.' });
      const reading = {
        type: body.type,
        source: body.source.trim().slice(0, 100),
        recordedAt: new Date().toISOString(),
        readings,
      };
      const profile = readPatient(auth.patient);
      const deviceReadings = [...(Array.isArray(profile.deviceReadings) ? profile.deviceReadings : []), reading].slice(-500);
      updatePatientHealth(auth.patient.id, { ...profile, deviceReadings });
      return json(response, 201, { reading, readings: deviceReadings });
    }

    if (request.method === 'POST' && url.pathname === '/api/profile/pin') {
      const auth = currentPatient(request);
      if (!auth) return json(response, 401, { error: 'Sign in required.' });
      const body = await readBody(request);
      if (!verifyPin(String(body.currentPin || ''), auth.patient.pin_salt, auth.patient.pin_hash)) {
        return json(response, 401, { error: 'Current PIN is incorrect.' });
      }
      if (!pinOkay(body.newPin)) return json(response, 400, { error: 'PIN must contain exactly four digits.' });
      if (findPatientsByPin(body.newPin).some((patient) => patient.id !== auth.patient.id)) {
        return json(response, 409, { error: 'That PIN is already in use. Choose a different four-digit PIN.' });
      }
      updatePatientPin(auth.patient.id, body.newPin);
      return json(response, 200, { ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/api/session/end') {
      const auth = currentPatient(request);
      if (!auth) return json(response, 401, { error: 'Sign in required.' });
      logSession(auth.patient, await readBody(request));
      database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(auth.tokenHash);
      return json(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }

    if (request.method === 'POST' && url.pathname === '/api/passkeys/register/options') {
      const auth = currentPatient(request);
      if (!auth) return json(response, 401, { error: 'Sign in required.' });
      const body = await readBody(request);
      const { origin, rpID } = requestOrigin(request);
      const existing = database.prepare('SELECT credential_id, transports FROM passkeys WHERE patient_id = ?').all(auth.patient.id);
      const options = await generateRegistrationOptions({
        rpName: 'M. I. A.',
        rpID,
        userID: new Uint8Array(Buffer.from(auth.patient.id)),
        userName: auth.patient.name,
        userDisplayName: auth.patient.name,
        attestationType: 'none',
        authenticatorSelection: {
          authenticatorAttachment: body.externalOnly === true ? 'cross-platform' : 'platform',
          residentKey: 'preferred',
          userVerification: 'required',
        },
        excludeCredentials: existing.map((item) => ({ id: item.credential_id, transports: JSON.parse(item.transports) })),
      });
      pruneExpiredChallenges();
      challenges.set(options.challenge, { purpose: 'register', patientId: auth.patient.id, origin, rpID, expiresAt: Date.now() + 5 * 60 * 1000 });
      return json(response, 200, options);
    }

    if (request.method === 'POST' && url.pathname === '/api/passkeys/register/verify') {
      const auth = currentPatient(request);
      if (!auth) return json(response, 401, { error: 'Sign in required.' });
      const body = await readBody(request);
      const pending = challenges.get(body.challenge);
      if (!pending || !consumeChallenge(body.challenge, 'register', auth.patient.id)) return json(response, 400, { error: 'Passkey request expired. Try again.' });
      const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: body.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rpID,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) return json(response, 400, { error: 'Passkey setup was not verified.' });
      const credential = verification.registrationInfo.credential;
      database.prepare('INSERT INTO passkeys (credential_id, patient_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)').run(
        credential.id,
        auth.patient.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports || []),
      );
      return json(response, 201, { ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/api/passkeys/login/options') {
      const { origin, rpID } = requestOrigin(request);
      const credentials = database.prepare('SELECT credential_id, transports FROM passkeys').all();
      if (!credentials.length) return json(response, 404, { error: 'No passkey is set up for this account.' });
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: credentials.map((item) => ({ id: item.credential_id, transports: JSON.parse(item.transports) })),
        userVerification: 'required',
      });
      pruneExpiredChallenges();
      challenges.set(options.challenge, { purpose: 'login', patientId: null, origin, rpID, expiresAt: Date.now() + 5 * 60 * 1000 });
      return json(response, 200, options);
    }

    if (request.method === 'POST' && url.pathname === '/api/passkeys/login/verify') {
      const body = await readBody(request);
      const credentialId = body.id;
      const saved = database.prepare('SELECT * FROM passkeys WHERE credential_id = ?').get(credentialId);
      const pending = challenges.get(body.response?.clientDataJSON ? body.challenge : '');
      const challenge = body.challenge || pending?.challenge;
      const challengeEntry = challenge && challenges.get(challenge);
      if (!saved || !challengeEntry || !consumeChallenge(challenge, 'login', saved.patient_id)) return json(response, 401, { error: 'Passkey sign-in failed. Try again.' });
      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: challengeEntry.origin,
        expectedRPID: challengeEntry.rpID,
        requireUserVerification: true,
        credential: {
          id: saved.credential_id,
          publicKey: new Uint8Array(saved.public_key),
          counter: saved.counter,
          transports: JSON.parse(saved.transports),
        },
      });
      if (!verification.verified) return json(response, 401, { error: 'Passkey sign-in failed.' });
      database.prepare('UPDATE passkeys SET counter = ? WHERE credential_id = ?').run(verification.authenticationInfo.newCounter, saved.credential_id);
      const patient = findPatientById(saved.patient_id);
      const startedAt = createSession(response, patient.id);
      return json(response, 200, { profile: publicProfile(patient), startedAt });
    }

    return json(response, 404, { error: 'Not found.' });
  } catch (error) {
    console.error('Local API error:', error);
    return json(response, 400, { error: error.message || 'Request failed.' });
  }
}

const createServer = tlsOptions
  ? (listener) => https.createServer(tlsOptions, listener)
  : (listener) => http.createServer(listener);
export const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error('Unhandled API error:', error);
    if (!response.headersSent) json(response, 500, { error: 'Local service error.' });
    else response.destroy();
  });
});
export { clearLoginSessions, database };

const protocol = tlsOptions ? 'https' : 'http';
server.listen(PORT, HOST, () => console.log(`M. I. A. local service listening at ${protocol}://${HOST}:${PORT}`));