const assert = require('node:assert/strict');
const { createCipheriv, randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createKeyFile,
  initializePortableStorage,
  resolveStoragePaths,
  unlockKeyFile,
} = require('./portableStorage.cjs');

const masterPassword = 'Correct horse battery staple!';

function encryptStoredValue(value, encryptionKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function createDatabase(databasePath, encryptionKey) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE patients (id TEXT PRIMARY KEY, health_data TEXT NOT NULL);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  database.prepare('INSERT INTO patients VALUES (?, ?)').run(
    'patient-1',
    encryptStoredValue({ assessmentHistory: [{ id: 'assessment-1' }] }, encryptionKey),
  );
  database.prepare('INSERT INTO app_settings VALUES (?, ?)').run(
    'inventory',
    encryptStoredValue({ medicalItems: [] }, encryptionKey),
  );
  database.close();
}

test('stores packaged data beside the executable and development data in the project', () => {
  assert.deepEqual(resolveStoragePaths({
    isPackaged: true,
    executablePath: 'E:\\MIA\\M. I. A.exe',
    appPath: 'ignored',
  }), {
    applicationDir: 'E:\\MIA',
    dataDir: 'E:\\MIA\\data',
    databasePath: 'E:\\MIA\\data\\marsmedic.sqlite',
    keyPath: 'E:\\MIA\\data\\health-data.key',
    userDataPath: 'E:\\MIA\\data\\electron',
  });
  assert.deepEqual(resolveStoragePaths({
    isPackaged: false,
    executablePath: 'ignored',
    appPath: 'C:\\project',
  }), {
    applicationDir: 'C:\\project',
    dataDir: 'C:\\project\\data',
    databasePath: 'C:\\project\\data\\marsmedic.sqlite',
    keyPath: 'C:\\project\\data\\health-data.key',
    userDataPath: 'C:\\project\\data\\electron',
  });
});

test('wraps the database key with a portable master password', () => {
  const key = randomBytes(32);
  const keyFile = createKeyFile(key, masterPassword);
  assert.equal(keyFile.includes(key), false);
  assert.equal(keyFile.includes(Buffer.from(masterPassword)), false);
  assert.deepEqual(unlockKeyFile(keyFile, masterPassword), key);
  assert.throws(
    () => unlockKeyFile(keyFile, 'incorrect master password'),
    { code: 'ERR_PORTABLE_UNLOCK' },
  );
  assert.throws(() => createKeyFile(key, 'short'), /at least 12 characters/);
});

test('creates a protected first-run data pair and reopens it without losing data', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mia-portable-first-run-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'app', 'data');
  const legacyDataDir = path.join(root, 'legacy', 'data');
  const legacyKeyPath = path.join(root, 'legacy', 'health-data.key');

  const firstRun = await initializePortableStorage({
    dataDir,
    legacyDataDir,
    legacyKeyPath,
    getPassword: async (mode) => {
      assert.equal(mode, 'create');
      return masterPassword;
    },
  });
  assert.equal(firstRun.migrated, false);
  assert.equal(existsSync(path.join(dataDir, 'marsmedic.sqlite')), true);
  assert.equal(readFileSync(path.join(dataDir, 'health-data.key')).includes(firstRun.encryptionKey), false);
  const initializedDatabase = new DatabaseSync(path.join(dataDir, 'marsmedic.sqlite'));
  initializedDatabase.exec(`
    CREATE TABLE patients (id TEXT PRIMARY KEY, health_data TEXT NOT NULL);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  initializedDatabase.close();

  const secondRun = await initializePortableStorage({
    dataDir,
    legacyDataDir,
    legacyKeyPath,
    getPassword: async (mode) => {
      assert.equal(mode, 'unlock');
      return masterPassword;
    },
  });
  assert.deepEqual(secondRun.encryptionKey, firstRun.encryptionKey);
  const database = new DatabaseSync(path.join(dataDir, 'marsmedic.sqlite'));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='patients'").get().count, 1);
  database.close();
});

test('migrates the existing database and key while preserving the original files', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mia-portable-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const legacyDataDir = path.join(root, 'legacy', 'data');
  const legacyKeyPath = path.join(root, 'legacy', 'health-data.key');
  const dataDir = path.join(root, 'portable', 'data');
  mkdirSync(legacyDataDir, { recursive: true });

  const legacyDatabasePath = path.join(legacyDataDir, 'marsmedic.sqlite');
  const encryptionKey = randomBytes(32);
  createDatabase(legacyDatabasePath, encryptionKey);
  writeFileSync(legacyKeyPath, encryptionKey);

  const result = await initializePortableStorage({
    dataDir,
    legacyDataDir,
    legacyKeyPath,
    getPassword: async (mode) => {
      assert.equal(mode, 'create');
      return masterPassword;
    },
  });
  assert.equal(result.migrated, true);
  assert.deepEqual(result.encryptionKey, encryptionKey);
  assert.equal(existsSync(legacyDatabasePath), true);
  assert.equal(readFileSync(legacyKeyPath).compare(encryptionKey), 0);

  const portableDatabase = new DatabaseSync(path.join(dataDir, 'marsmedic.sqlite'), { readOnly: true });
  assert.equal(portableDatabase.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(portableDatabase.prepare('SELECT COUNT(*) AS count FROM patients').get().count, 1);
  assert.equal(portableDatabase.prepare('SELECT COUNT(*) AS count FROM app_settings').get().count, 1);
  portableDatabase.close();
  assert.equal(readFileSync(path.join(dataDir, 'health-data.key')).includes(encryptionKey), false);
});

test('migrates matching USB transfer data before the local Windows copy', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mia-portable-transfer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const transferDir = path.join(root, 'MIA Patient Data Transfer');
  const transferDataDir = path.join(transferDir, 'data');
  const localDir = path.join(root, 'MarsMedic AI');
  const localDataDir = path.join(localDir, 'data');
  mkdirSync(transferDataDir, { recursive: true });
  mkdirSync(localDataDir, { recursive: true });

  const encryptionKey = randomBytes(32);
  const transferDatabasePath = path.join(transferDataDir, 'marsmedic.sqlite');
  createDatabase(transferDatabasePath, encryptionKey);
  writeFileSync(path.join(transferDir, 'health-data.key'), encryptionKey);
  writeFileSync(path.join(localDataDir, 'marsmedic.sqlite'), readFileSync(transferDatabasePath));
  writeFileSync(path.join(localDir, 'health-data.key'), encryptionKey);

  const result = await initializePortableStorage({
    dataDir: path.join(root, 'portable', 'data'),
    legacySources: [
      { dataDir: transferDataDir, keyPath: path.join(transferDir, 'health-data.key') },
      { dataDir: localDataDir, keyPath: path.join(localDir, 'health-data.key') },
    ],
    getPassword: async (mode) => {
      assert.equal(mode, 'create');
      return masterPassword;
    },
  });

  assert.equal(result.migrated, true);
  assert.equal(result.legacyDatabasePath, transferDatabasePath);
  assert.equal(existsSync(transferDatabasePath), true);
  assert.equal(existsSync(path.join(transferDir, 'health-data.key')), true);
});

test('refuses to choose between different legacy data sources', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mia-portable-conflicting-sources-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const transferDir = path.join(root, 'MIA Patient Data Transfer');
  const localDir = path.join(root, 'MarsMedic AI');
  const transferDataDir = path.join(transferDir, 'data');
  const localDataDir = path.join(localDir, 'data');
  mkdirSync(transferDataDir, { recursive: true });
  mkdirSync(localDataDir, { recursive: true });
  createDatabase(path.join(transferDataDir, 'marsmedic.sqlite'), randomBytes(32));
  writeFileSync(path.join(transferDir, 'health-data.key'), randomBytes(32));
  createDatabase(path.join(localDataDir, 'marsmedic.sqlite'), randomBytes(32));
  writeFileSync(path.join(localDir, 'health-data.key'), randomBytes(32));
  const dataDir = path.join(root, 'portable', 'data');
  let promptedForPassword = false;

  await assert.rejects(
    initializePortableStorage({
      dataDir,
      legacySources: [
        { dataDir: transferDataDir, keyPath: path.join(transferDir, 'health-data.key') },
        { dataDir: localDataDir, keyPath: path.join(localDir, 'health-data.key') },
      ],
      getPassword: async () => {
        promptedForPassword = true;
        return masterPassword;
      },
    }),
    /Multiple previous account data sources do not match/,
  );
  assert.equal(promptedForPassword, false);
  assert.equal(existsSync(dataDir), false);
});

test('upgrades a legacy portable raw key without leaving it beside the database', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mia-portable-raw-key-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'portable', 'data');
  mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, 'marsmedic.sqlite');
  const keyPath = path.join(dataDir, 'health-data.key');
  const encryptionKey = randomBytes(32);
  createDatabase(databasePath, encryptionKey);
  writeFileSync(keyPath, encryptionKey);

  const result = await initializePortableStorage({
    dataDir,
    legacyDataDir: path.join(root, 'legacy', 'data'),
    legacyKeyPath: path.join(root, 'legacy', 'health-data.key'),
    getPassword: async (mode) => {
      assert.equal(mode, 'create');
      return masterPassword;
    },
  });
  assert.deepEqual(result.encryptionKey, encryptionKey);
  assert.equal(readFileSync(keyPath).includes(encryptionKey), false);
  assert.deepEqual(unlockKeyFile(readFileSync(keyPath), masterPassword), encryptionKey);
});

test('does not replace existing portable data or accept an incomplete pair', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mia-portable-partial-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'portable', 'data');
  mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, 'marsmedic.sqlite');
  writeFileSync(databasePath, 'existing portable database');

  await assert.rejects(
    initializePortableStorage({
      dataDir,
      legacyDataDir: path.join(root, 'legacy', 'data'),
      legacyKeyPath: path.join(root, 'legacy', 'health-data.key'),
      getPassword: async () => masterPassword,
    }),
    /only a database or key/,
  );
  assert.equal(readFileSync(databasePath, 'utf8'), 'existing portable database');
});

test('does not migrate a legacy database when its encryption key is missing', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mia-portable-no-key-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const legacyDataDir = path.join(root, 'legacy', 'data');
  mkdirSync(legacyDataDir, { recursive: true });
  const legacyDatabasePath = path.join(legacyDataDir, 'marsmedic.sqlite');
  createDatabase(legacyDatabasePath, randomBytes(32));
  const dataDir = path.join(root, 'portable', 'data');

  await assert.rejects(
    initializePortableStorage({
      dataDir,
      legacyDataDir,
      legacyKeyPath: path.join(root, 'legacy', 'health-data.key'),
      getPassword: async () => masterPassword,
    }),
    /database or encryption key is missing/,
  );
  assert.equal(existsSync(path.join(dataDir, 'marsmedic.sqlite')), false);
});

test('does not migrate an account database with a nonmatching key', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mia-portable-wrong-key-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const legacyDataDir = path.join(root, 'legacy', 'data');
  mkdirSync(legacyDataDir, { recursive: true });
  createDatabase(path.join(legacyDataDir, 'marsmedic.sqlite'), randomBytes(32));
  writeFileSync(path.join(root, 'legacy', 'health-data.key'), randomBytes(32));
  const dataDir = path.join(root, 'portable', 'data');

  await assert.rejects(
    initializePortableStorage({
      dataDir,
      legacyDataDir,
      legacyKeyPath: path.join(root, 'legacy', 'health-data.key'),
      getPassword: async () => masterPassword,
    }),
    /Unsupported state|unable to authenticate|authenticate data/i,
  );
  assert.equal(existsSync(path.join(dataDir, 'marsmedic.sqlite')), false);
});
