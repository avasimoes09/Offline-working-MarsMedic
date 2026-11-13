const {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');

const KEY_FILE_HEADER = 'MIA-PORTABLE-KEY-V1\n';
const KEY_LENGTH = 32;
const MIN_MASTER_PASSWORD_LENGTH = 12;

function resolveStoragePaths({ isPackaged, executablePath, appPath }) {
  const applicationDir = isPackaged ? path.dirname(executablePath) : appPath;
  const dataDir = path.join(applicationDir, 'data');
  return {
    applicationDir,
    dataDir,
    databasePath: path.join(dataDir, 'marsmedic.sqlite'),
    keyPath: path.join(dataDir, 'health-data.key'),
    userDataPath: path.join(dataDir, 'electron'),
  };
}

function deriveWrappingKey(password, salt) {
  return scryptSync(password, salt, KEY_LENGTH, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function createKeyFile(encryptionKey, password) {
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== KEY_LENGTH) {
    throw new Error('Invalid portable data encryption key.');
  }
  if (typeof password !== 'string' || password.length < MIN_MASTER_PASSWORD_LENGTH) {
    throw new Error(`The master password must contain at least ${MIN_MASTER_PASSWORD_LENGTH} characters.`);
  }

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrappingKey = deriveWrappingKey(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
    cipher.setAAD(Buffer.from(KEY_FILE_HEADER));
    const ciphertext = Buffer.concat([cipher.update(encryptionKey), cipher.final()]);
    return Buffer.from(`${KEY_FILE_HEADER}${JSON.stringify({
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    })}`);
  } finally {
    wrappingKey.fill(0);
  }
}

function unlockKeyFile(keyFile, password) {
  if (typeof password !== 'string' || !keyFile.subarray(0, KEY_FILE_HEADER.length).equals(Buffer.from(KEY_FILE_HEADER))) {
    const error = new Error('The portable encryption-key file is invalid or unsupported.');
    error.code = 'ERR_PORTABLE_KEY';
    throw error;
  }

  let envelope;
  let salt;
  let iv;
  let tag;
  let ciphertext;
  try {
    envelope = JSON.parse(keyFile.subarray(KEY_FILE_HEADER.length).toString('utf8'));
    salt = Buffer.from(envelope.salt, 'base64');
    iv = Buffer.from(envelope.iv, 'base64');
    tag = Buffer.from(envelope.tag, 'base64');
    ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length !== KEY_LENGTH) {
      throw new TypeError('Invalid key envelope.');
    }
  } catch {
    const error = new Error('The portable encryption-key file is damaged.');
    error.code = 'ERR_PORTABLE_KEY';
    throw error;
  }

  const wrappingKey = deriveWrappingKey(password, salt);
  try {
    const decipher = createDecipheriv('aes-256-gcm', wrappingKey, iv);
    decipher.setAAD(Buffer.from(KEY_FILE_HEADER));
    decipher.setAuthTag(tag);
    const key = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (key.length !== KEY_LENGTH) throw new Error('Invalid key length.');
    return key;
  } catch {
    const error = new Error('The master password is incorrect.');
    error.code = 'ERR_PORTABLE_UNLOCK';
    throw error;
  } finally {
    wrappingKey.fill(0);
  }
}

function decryptDatabaseValue(value, encryptionKey) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted database value.');
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

function validateDatabase(databasePath, encryptionKey, { requirePatientTable = false } = {}) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    const integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error('The patient database failed its integrity check.');
    const patientTable = database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'patients'",
    ).get();
    if (!patientTable) {
      const userTables = database.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      ).get().count;
      if (requirePatientTable || userTables !== 0) {
        throw new Error('The patient database is missing its accounts table.');
      }
      return;
    }
    for (const patient of database.prepare('SELECT health_data FROM patients').all()) {
      decryptDatabaseValue(patient.health_data, encryptionKey);
    }
    const settingsTable = database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'",
    ).get();
    if (settingsTable) {
      for (const setting of database.prepare('SELECT value FROM app_settings').all()) {
        decryptDatabaseValue(setting.value, encryptionKey);
      }
    }
  } finally {
    database.close();
  }
}

function writeKeyFile(keyPath, keyFile) {
  const temporaryPath = `${keyPath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    writeFileSync(temporaryPath, keyFile, { flag: 'wx', mode: 0o600 });
    renameSync(temporaryPath, keyPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function installNewPortablePair({ dataDir, databasePath, keyPath, keyFile, stagedDatabasePath }) {
  const stageDirectory = mkdtempSync(path.join(dataDir, '.portable-setup-'));
  const stagedKeyPath = path.join(stageDirectory, 'health-data.key');
  let databaseInstalled = false;
  let keyInstalled = false;
  try {
    const stagedDatabase = path.join(stageDirectory, 'marsmedic.sqlite');
    if (stagedDatabasePath) {
      renameSync(stagedDatabasePath, stagedDatabase);
    } else {
      const emptyDatabase = new DatabaseSync(stagedDatabase);
      emptyDatabase.close();
    }
    writeFileSync(stagedKeyPath, keyFile, { flag: 'wx', mode: 0o600 });
    renameSync(stagedDatabase, databasePath);
    databaseInstalled = true;
    renameSync(stagedKeyPath, keyPath);
    keyInstalled = true;
  } catch (error) {
    if (databaseInstalled) rmSync(databasePath, { force: true });
    if (keyInstalled) rmSync(keyPath, { force: true });
    throw error;
  } finally {
    rmSync(stageDirectory, { recursive: true, force: true });
  }
}

async function initializePortableStorage({
  dataDir,
  legacyDataDir,
  legacyKeyPath,
  legacySources = [],
  getPassword,
}) {
  const databasePath = path.join(dataDir, 'marsmedic.sqlite');
  const keyPath = path.join(dataDir, 'health-data.key');
  const hasDatabase = existsSync(databasePath);
  const hasKey = existsSync(keyPath);

  if (hasDatabase || hasKey) {
    if (!hasDatabase || !hasKey) {
      throw new Error('The USB data folder has only a database or key. Nothing was changed; restore the matching pair before starting M. I. A.');
    }

    const existingKeyFile = readFileSync(keyPath);
    if (existingKeyFile.length === KEY_LENGTH) {
      const password = await getPassword('create');
      if (password == null) return { cancelled: true };
      const encryptionKey = Buffer.from(existingKeyFile);
      try {
        validateDatabase(databasePath, encryptionKey);
        writeKeyFile(keyPath, createKeyFile(encryptionKey, password));
        return { encryptionKey, migrated: false, protectedExistingKey: true };
      } catch (error) {
        encryptionKey.fill(0);
        throw error;
      }
    }

    const password = await getPassword('unlock');
    if (password == null) return { cancelled: true };
    const encryptionKey = unlockKeyFile(existingKeyFile, password);
    try {
      validateDatabase(databasePath, encryptionKey);
      return { encryptionKey, migrated: false, protectedExistingKey: false };
    } catch (error) {
      encryptionKey.fill(0);
      throw error;
    }
  }

  const legacyCandidates = [
    ...(legacyDataDir && legacyKeyPath ? [{ dataDir: legacyDataDir, keyPath: legacyKeyPath }] : []),
    ...legacySources,
  ];
  const availableLegacySources = [];
  for (const source of legacyCandidates) {
    const sourceDatabasePath = path.join(source.dataDir, 'marsmedic.sqlite');
    const hasSourceDatabase = existsSync(sourceDatabasePath);
    const hasSourceKey = existsSync(source.keyPath);
    if (hasSourceDatabase !== hasSourceKey) {
      throw new Error('A previous account data source is incomplete: its database or encryption key is missing. Nothing was migrated.');
    }
    if (hasSourceDatabase) {
      availableLegacySources.push({
        databasePath: sourceDatabasePath,
        keyPath: source.keyPath,
      });
    }
  }
  if (availableLegacySources.length > 1) {
    const firstSource = availableLegacySources[0];
    const firstDatabase = readFileSync(firstSource.databasePath);
    const firstKey = readFileSync(firstSource.keyPath);
    const sourcesMatch = availableLegacySources.slice(1).every((source) => (
      readFileSync(source.databasePath).equals(firstDatabase)
      && readFileSync(source.keyPath).equals(firstKey)
    ));
    if (!sourcesMatch) {
      throw new Error('Multiple previous account data sources do not match. Nothing was migrated.');
    }
  }

  const legacySource = availableLegacySources[0] || null;
  const legacyDatabasePath = legacySource?.databasePath || null;
  const hasLegacyDatabase = legacySource !== null;
  const password = await getPassword('create');
  if (password == null) return { cancelled: true };
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const encryptionKey = hasLegacyDatabase
    ? readFileSync(legacySource.keyPath)
    : randomBytes(KEY_LENGTH);
  if (encryptionKey.length !== KEY_LENGTH) {
    encryptionKey.fill(0);
    throw new Error('The previous Windows encryption key is invalid. Nothing was migrated.');
  }

  let stagedDatabasePath;
  let source;
  try {
    if (hasLegacyDatabase) {
      const stageDirectory = mkdtempSync(path.join(dataDir, '.migration-'));
      stagedDatabasePath = path.join(stageDirectory, 'marsmedic.sqlite');
      try {
        source = new DatabaseSync(legacyDatabasePath, { readOnly: true });
        source.exec('PRAGMA busy_timeout = 5000');
        const escapedPath = stagedDatabasePath.replace(/'/g, "''");
        source.exec(`VACUUM INTO '${escapedPath}'`);
        source.close();
        source = null;
        validateDatabase(stagedDatabasePath, encryptionKey, { requirePatientTable: true });
      } finally {
        source?.close();
      }
    }

    const keyFile = createKeyFile(encryptionKey, password);
    installNewPortablePair({
      dataDir,
      databasePath,
      keyPath,
      keyFile,
      stagedDatabasePath,
    });
    return {
      encryptionKey,
      migrated: hasLegacyDatabase,
      legacyDatabasePath: hasLegacyDatabase ? legacyDatabasePath : null,
    };
  } catch (error) {
    encryptionKey.fill(0);
    throw error;
  } finally {
    if (stagedDatabasePath) rmSync(path.dirname(stagedDatabasePath), { recursive: true, force: true });
  }
}

module.exports = {
  createKeyFile,
  initializePortableStorage,
  resolveStoragePaths,
  unlockKeyFile,
};
