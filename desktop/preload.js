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
  getCliqConnection: () => ipcRenderer.invoke('cliq:connection:get'),
  startCliqLink: (timeZone) => ipcRenderer.invoke('cliq:connection:start', timeZone),
  confirmCliqLink: () => ipcRenderer.invoke('cliq:connection:confirm'),
  setCliqIntake: (enabled) => ipcRenderer.invoke('cliq:connection:enable', enabled),
  fetchCliqCommands: () => ipcRenderer.invoke('cliq:connection:fetch'),
  unlinkCliq: () => ipcRenderer.invoke('cliq:connection:unlink'),
  onCliqCommandsApplied: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('cliq:commands-applied', handler);
    return () => ipcRenderer.removeListener('cliq:commands-applied', handler);
  },
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
  // Shared workspaces. Everything goes through the shell, which holds the cloud session.
  workspaces: {
    status: () => ipcRenderer.invoke('ws:status'),
    onStatus: (listener) => {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on('workspaces:status', handler);
      return () => ipcRenderer.removeListener('workspaces:status', handler);
    },
    active: () => ipcRenderer.invoke('ws:active'),
    select: (options) => ipcRenderer.invoke('ws:select', options),
    refresh: () => ipcRenderer.invoke('ws:refresh'),
    create: (options) => ipcRenderer.invoke('ws:create', options),
    invite: (options) => ipcRenderer.invoke('ws:invite', options),
    accept: (options) => ipcRenderer.invoke('ws:accept', options),
    removeMember: (options) => ipcRenderer.invoke('ws:remove', options),
    leave: (options) => ipcRenderer.invoke('ws:leave', options),
    onChanged: (listener) => {
      const handler = (_event, info) => listener(info);
      ipcRenderer.on('workspaces:changed', handler);
      return () => ipcRenderer.removeListener('workspaces:changed', handler);
    },
    onAssigned: (listener) => {
      const handler = (_event, info) => listener(info);
      ipcRenderer.on('workspaces:assigned', handler);
      return () => ipcRenderer.removeListener('workspaces:assigned', handler);
    },
  },
});
