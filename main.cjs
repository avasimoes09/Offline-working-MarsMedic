const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { initializePortableStorage, resolveStoragePaths } = require('./portableStorage.cjs');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName('M. I. A.');
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP localhost 127.0.0.1');
  const storagePaths = resolveStoragePaths({
    isPackaged: app.isPackaged,
    executablePath: process.execPath,
    appPath: app.getAppPath(),
  });
  app.setPath('userData', storagePaths.userDataPath);
  app.setPath('sessionData', storagePaths.userDataPath);

  let localServer;
  let database;
  let encryptionKey;

  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.on('before-quit', () => {
    if (localServer?.listening) localServer.close(() => database?.close());
    else database?.close();
    encryptionKey?.fill(0);
    delete process.env.MARSMEDIC_ENCRYPTION_KEY;
  });

  function requestMasterPassword(mode) {
    return new Promise((resolve) => {
      const prompt = new BrowserWindow({
        width: 520,
        height: 610,
        resizable: false,
        minimizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        show: false,
        title: mode === 'create' ? 'Protect M. I. A. data' : 'Unlock M. I. A. data',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload: path.join(__dirname, 'master-password-preload.cjs'),
        },
      });
      let settled = false;
      const cleanup = () => {
        ipcMain.removeListener('mia:master-password-submit', submit);
        ipcMain.removeListener('mia:master-password-cancel', cancel);
      };
      const finish = (password) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(password);
        if (!prompt.isDestroyed()) prompt.close();
      };
      const submit = (event, value) => {
        if (event.sender !== prompt.webContents || !value || typeof value.password !== 'string') return;
        if (value.password.length > 256) {
          prompt.webContents.send('mia:master-password-error', 'The password is too long.');
          return;
        }
        if (mode === 'create' && value.password.length < 12) {
          prompt.webContents.send('mia:master-password-error', 'Use at least 12 characters for the master password.');
          return;
        }
        if (mode === 'create' && value.password !== value.confirmation) {
          prompt.webContents.send('mia:master-password-error', 'The passwords do not match.');
          return;
        }
        finish(value.password);
      };
      const cancel = (event) => {
        if (event.sender === prompt.webContents) finish(null);
      };
      ipcMain.on('mia:master-password-submit', submit);
      ipcMain.on('mia:master-password-cancel', cancel);
      prompt.on('closed', () => finish(null));
      prompt.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      prompt.webContents.on('will-navigate', (event) => event.preventDefault());
      prompt.once('ready-to-show', () => prompt.show());
      prompt.loadFile(path.join(__dirname, 'master-password.html'), { query: { mode } }).catch((error) => {
        cleanup();
        finish(null);
        console.error('Unable to open the portable data password prompt:', error);
      });
    });
  }

  app.whenReady().then(async () => {
    try {
      const legacyUserData = path.join(app.getPath('appData'), 'MarsMedic AI');
      const legacySources = [{
        dataDir: path.join(legacyUserData, 'data'),
        keyPath: path.join(legacyUserData, 'health-data.key'),
      }];
      if (app.isPackaged) {
        const transferFolder = path.join(path.dirname(storagePaths.applicationDir), 'MIA Patient Data Transfer');
        legacySources.unshift({
          dataDir: path.join(transferFolder, 'data'),
          keyPath: path.join(transferFolder, 'health-data.key'),
        });
      }
      mkdirSync(storagePaths.dataDir, { recursive: true, mode: 0o700 });
      let portableStorage;
      while (!portableStorage) {
        try {
          portableStorage = await initializePortableStorage({
            dataDir: storagePaths.dataDir,
            legacySources,
            getPassword: requestMasterPassword,
          });
        } catch (error) {
          if (error.code !== 'ERR_PORTABLE_UNLOCK') throw error;
          await dialog.showMessageBox({
            type: 'error',
            title: 'Unable to unlock patient data',
            message: error.message,
            buttons: ['Try again'],
          });
        }
      }
      if (portableStorage.cancelled) {
        app.quit();
        return;
      }
      encryptionKey = portableStorage.encryptionKey;
      mkdirSync(storagePaths.userDataPath, { recursive: true, mode: 0o700 });
      if (portableStorage.migrated) {
        console.info('Migrated local account data into the application data folder; the previous copy was preserved.');
      }
      process.env.MARSMEDIC_DATA_DIR = storagePaths.dataDir;
      process.env.MARSMEDIC_KEY_PATH = storagePaths.keyPath;
      process.env.MARSMEDIC_ENCRYPTION_KEY = encryptionKey.toString('hex');
      process.env.API_HOST = '127.0.0.1';
      process.env.API_PORT = '0';
      process.env.NODE_ENV = 'production';

      const serverModule = await import(pathToFileURL(path.join(app.getAppPath(), 'server/index.js')).href);
      delete process.env.MARSMEDIC_ENCRYPTION_KEY;
      localServer = serverModule.server;
      database = serverModule.database;
      if (!localServer.listening) await once(localServer, 'listening');

      const address = localServer.address();
      const appUrl = `http://localhost:${address.port}`;

      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        let allowed = false;
        try {
          const requestedUrl = new URL(details.url);
          allowed = requestedUrl.origin === appUrl;
        } catch {
          allowed = false;
        }
        callback({ cancel: !allowed });
      });

      const window = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 960,
        minHeight: 700,
        icon: path.join(app.getAppPath(), 'public', 'mia.ico'),
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      const isAppOrigin = (url) => {
        try {
          return new URL(url).origin === appUrl;
        } catch {
          return false;
        }
      };
      let bluetoothChooserOpen = false;
      window.webContents.on('select-bluetooth-device', (event, devices, callback) => {
        event.preventDefault();
        if (!isAppOrigin(window.webContents.getURL())) {
          callback('');
          return;
        }
        if (bluetoothChooserOpen || devices.length === 0) return;

        bluetoothChooserOpen = true;
        const buttons = devices.map((device, index) => (
          `${index + 1}. ${device.deviceName || 'Unnamed Bluetooth device'}`
        ));
        buttons.push('Cancel');
        dialog.showMessageBox(window, {
          type: 'question',
          title: 'Select Bluetooth device',
          message: 'Choose a compatible Bluetooth device to connect to M. I. A.',
          buttons,
          cancelId: buttons.length - 1,
          defaultId: 0,
        }).then(({ response }) => {
          callback(devices[response]?.deviceId || '');
        }).catch((error) => {
          console.error('Unable to show Bluetooth device chooser:', error);
          callback('');
        }).finally(() => {
          bluetoothChooserOpen = false;
        });
      });
      if (process.platform === 'win32' || process.platform === 'linux') {
        session.defaultSession.setBluetoothPairingHandler((details, callback) => {
          if (!details.frame || !isAppOrigin(details.frame.url)) {
            callback({ confirmed: false });
            return;
          }
          if (details.pairingKind === 'providePin') {
            dialog.showMessageBox(window, {
              type: 'info',
              title: 'Bluetooth device requires a PIN',
              message: 'Pair this device in your computer’s Bluetooth settings, then reconnect it in M. I. A.',
              buttons: ['OK'],
            }).then(
              () => callback({ confirmed: false }),
              (error) => {
                console.error('Unable to show Bluetooth pairing instructions:', error);
                callback({ confirmed: false });
              },
            );
            return;
          }
          const message = details.pairingKind === 'confirmPin'
            ? `Confirm that the Bluetooth device displays this PIN: ${details.pin || ''}`
            : 'Allow this Bluetooth device to pair with M. I. A.?';
          dialog.showMessageBox(window, {
            type: 'question',
            title: 'Confirm Bluetooth pairing',
            message,
            buttons: ['Pair', 'Cancel'],
            cancelId: 1,
            defaultId: 0,
          }).then(({ response }) => {
            callback({ confirmed: response === 0 });
          }).catch((error) => {
            console.error('Unable to show Bluetooth pairing prompt:', error);
            callback({ confirmed: false });
          });
        });
      }
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        if (new URL(url).origin !== appUrl) event.preventDefault();
      });
      await window.loadURL(appUrl);
    } catch (error) {
      console.error('Unable to start M. I. A.:', error);
      dialog.showErrorBox(
        'M. I. A. could not start',
        `The local app service failed to start.\n\n${error.message}`,
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
}
