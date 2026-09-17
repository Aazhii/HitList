/**
 * The desktop bridge exposed by electron/preload.ts when this build is
 * running inside the Electron shell. Absent on the web — every access must
 * be optional-chained.
 *
 * Deliberately tiny: a capability flag and the platform string. The renderer
 * has no other reason to know it is inside Electron — it talks to the local
 * server over the same relative /api/* calls either way (see src/lib/api.ts),
 * and native notifications already work for free through the standard web
 * Notification API (src/lib/notifications.ts) with no bridge involved.
 */
export interface KaizenDesktopBridge {
  isElectron: true;
  platform: string;
}

declare global {
  interface Window {
    kaizenDesktop?: KaizenDesktopBridge;
  }
}

export {};
