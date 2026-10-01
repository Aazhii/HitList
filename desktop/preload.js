// The only thing the page may ask of the shell: who is signed in, and to sign in or out. No other access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hitlistDesktop', {
  getAccount: () => ipcRenderer.invoke('account:get'),
  signIn: () => ipcRenderer.invoke('account:signIn'),
  signOut: () => ipcRenderer.invoke('account:signOut'),
});
