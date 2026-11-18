const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miaMasterPassword', {
  cancel: () => ipcRenderer.send('mia:master-password-cancel'),
  onError: (callback) => {
    ipcRenderer.on('mia:master-password-error', (_event, message) => callback(message));
  },
  submit: (password, confirmation) => ipcRenderer.send('mia:master-password-submit', { password, confirmation }),
});
