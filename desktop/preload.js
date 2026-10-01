// The only thing the page may ask of the shell: who is signed in, and to sign in or out. No other access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hitlistDesktop', {
  getAccount: () => ipcRenderer.invoke('account:get'),
  signIn: () => ipcRenderer.invoke('account:signIn'),
  signOut: () => ipcRenderer.invoke('account:signOut'), // resolves { backup: <how the last backup went> }
  getBackupStatus: () => ipcRenderer.invoke('backup:status'),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  checkRestore: (opts) => ipcRenderer.invoke('restore:check', opts),
  restoreNow: () => ipcRenderer.invoke('restore:run'),
  getCliq: () => ipcRenderer.invoke('cliq:get'),
  setCliq: (settings) => ipcRenderer.invoke('cliq:set', settings),
  getUpdate: () => ipcRenderer.invoke('update:status'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  cancelUpdate: () => ipcRenderer.invoke('update:cancel'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  testCliq: () => ipcRenderer.invoke('cliq:test'),
});
