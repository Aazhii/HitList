/**
 * Preload — the only bridge between the renderer and Node/Electron.
 *
 * Exposes nothing beyond a capability flag. The renderer already speaks to
 * the local server over ordinary same-origin `fetch('/api/...')`, exactly as
 * it does on the web; there is no ipcRenderer channel, no filesystem access
 * and no shell access handed to page script. contextIsolation is on and
 * nodeIntegration is off (see electron/main.ts), so this file — not the
 * page — is the only place with access to Node and Electron APIs.
 */
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('kaizenDesktop', {
  isElectron: true,
  platform: process.platform,
});
