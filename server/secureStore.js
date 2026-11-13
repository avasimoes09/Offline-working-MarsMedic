import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.MARSMEDIC_DATA_DIR || path.join(projectRoot, 'data'));
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
try { chmodSync(dataDir, 0o700); } catch { /* platform may not support POSIX modes */ }

const configuredKey = process.env.MARSMEDIC_ENCRYPTION_KEY;
let encryptionKey;
if (configuredKey !== undefined) {
  if (!/^[\da-f]{64}$/i.test(configuredKey)) throw new Error('Invalid in-memory health-data key.');
  encryptionKey = Buffer.from(configuredKey, 'hex');
} else {
  const keyPath = path.resolve(process.env.MARSMEDIC_KEY_PATH || path.join(dataDir, 'health-data.key'));
  mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  encryptionKey = readFileSync(keyPath);
}
if (encryptionKey.length !== 32) throw new Error('Invalid local health-data key.');
if (configuredKey === undefined) {
  try { chmodSync(path.resolve(process.env.MARSMEDIC_KEY_PATH || path.join(dataDir, 'health-data.key')), 0o600); } catch { /* platform may not support POSIX modes */ }
}

export const database = new DatabaseSync(path.join(dataDir, 'marsmedic.sqlite'));
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    pin_salt BLOB NOT NULL,
    pin_hash BLOB NOT NULL,
    health_data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS passkeys (
    credential_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export function clearLoginSessions() {
  database.prepare('DELETE FROM sessions').run();
}

export const hashPin = (pin, salt = randomBytes(16)) => ({
  salt,
  hash: scryptSync(pin, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }),
});

export function verifyPin(pin, salt, expectedHash) {
  const actual = hashPin(pin, salt).hash;
  return actual.length === expectedHash.length && timingSafeEqual(actual, expectedHash);
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decrypt(value) {
  const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

export function createPatient({ id, username, name, pin, healthData }) {
  const salt = randomBytes(16);
  const { hash } = hashPin(pin, salt);
  database.prepare(`
    INSERT INTO patients (id, username, name, pin_salt, pin_hash, health_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, username, name, salt, hash, encrypt(healthData), new Date().toISOString());
}

export function findPatientByUsername(username) {
  return database.prepare('SELECT * FROM patients WHERE username = ?').get(username);
}

export function findPatientsByPin(pin) {
  return database.prepare('SELECT * FROM patients').all()
    .filter((patient) => verifyPin(pin, patient.pin_salt, patient.pin_hash));
}

export function findPatientById(id) {
  return database.prepare('SELECT * FROM patients WHERE id = ?').get(id);
}

export function readPatient(patient) {
  return {
    id: patient.id,
    name: patient.name,
    ...decrypt(patient.health_data),
  };
}

export function updatePatientHealth(patientId, healthData) {
  database.prepare('UPDATE patients SET health_data = ? WHERE id = ?').run(encrypt(healthData), patientId);
}

export function readAppSetting(key) {
  const row = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? decrypt(row.value) : null;
}

export function writeAppSetting(key, value) {
  database.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, encrypt(value));
}

export function updatePatientPin(patientId, pin) {
  const salt = randomBytes(16);
  const { hash } = hashPin(pin, salt);
  database.prepare('UPDATE patients SET pin_salt = ?, pin_hash = ? WHERE id = ?').run(salt, hash, patientId);
}

export function deletePatient(patientId) {
  database.prepare('DELETE FROM patients WHERE id = ?').run(patientId);
}