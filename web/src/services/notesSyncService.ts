/**
 * NotesSyncService — lightweight offline-safe sync layer for notes.
 *
 * Strategy:
 *  - localStorage is ALWAYS the source of truth for reads.
 *  - Every mutation is queued here and flushed to the server asynchronously.
 *  - Queue deduplicates by noteId: only the latest op per note is kept.
 *  - Last-write-wins via updatedAt timestamps (server enforces same rule).
 *  - Online/offline events drain / pause the queue automatically.
 *  - Listeners receive status updates so UI can react without polling.
 */

import { API_BASE_URL } from '@/lib/api';
import { simpleRequest } from '@/lib/simpleRequest';
import { getActiveTaskStorageId } from '@/lib/storage';
import { onSourceSave } from '@/lib/sourceSaves';
import { onPreLogout } from '@/lib/preLogout';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

type OpKind = 'upsert' | 'delete';

interface QueuedOp {
  kind: OpKind;
  noteId: string;
  payload?: NotePayload; // undefined for delete
  updatedAt: number;
}

export interface NotePayload {
  id: string;
  title: string;
  blocksJson: string;
  emoji?: string;
  pinned?: boolean;
  createdAt?: number;
  updatedAt: number;
}

type StatusListener = (status: SyncStatus) => void;

// ── Constants ─────────────────────────────────────────────────────────────────

// On the API's origin, which for the Slate build is not this page's origin.
// These were relative, so notes from Slate were sent to Slate itself.
const API_BASE = `${API_BASE_URL}/api/notes`;
const HEALTH_URL = `${API_BASE_URL}/api/health`;
const FLUSH_DEBOUNCE_MS = 600;
const HEALTH_CHECK_INTERVAL_MS = 15_000;

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * The server refused the note itself — too large, or otherwise invalid — as
 * opposed to being unreachable. Retrying the same payload cannot succeed, so it
 * is not retried, and it does not mark the server offline. The note stays in
 * localStorage; the next edit tries again.
 */
export class NoteRejectedError extends Error {
  readonly httpStatus: number;
  constructor(httpStatus: number, message: string) {
    super(message);
    this.name = 'NoteRejectedError';
    this.httpStatus = httpStatus;
  }
}

async function syncError(method: string, res: Response): Promise<Error> {
  if (res.status === 400 || res.status === 413 || res.status === 422) {
    let detail = '';
    try {
      const body = (await res.json()) as { message?: string; fields?: Record<string, string> };
      detail = Object.values(body.fields ?? {})[0] ?? body.message ?? '';
    } catch { /* no JSON body */ }
    return new NoteRejectedError(res.status, detail || `${method} ${res.status}`);
  }
  return new Error(`${method} ${res.status}`);
}

// ── Service ───────────────────────────────────────────────────────────────────

class NotesSyncService {
  private queue = new Map<string, QueuedOp>(); // noteId → latest op
  private status: SyncStatus = 'synced';
  private listeners = new Set<StatusListener>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;
  private activeFlush: Promise<void> | null = null;
  private serverReachable = true;
  private inFlight = new Map<string, QueuedOp>();
  private scope: string | null = null;
  private pendingRestored = false;
  private versions = new Map<string, number>();

  private pendingKey(): string { return `hitlist-note-writes:${this.scope ?? 'anonymous'}`; }

  private persistQueue(): void {
    const pending = new Map([...this.inFlight, ...this.queue]);
    try { localStorage.setItem(this.pendingKey(), JSON.stringify([...pending.values()])); } catch { /* storage unavailable */ }
  }

  restorePending(): void {
    const scope = getActiveTaskStorageId();
    if (scope !== this.scope) {
      if (this.queue.size || this.isFlushing) throw new Error('Pending notes belong to another workspace');
      this.scope = scope;
      this.pendingRestored = false;
      this.versions.clear();
    }
    if (this.pendingRestored) return;
    this.pendingRestored = true;
    try {
      const saved = JSON.parse(localStorage.getItem(this.pendingKey()) ?? '[]') as QueuedOp[];
      for (const op of saved) if (!this.queue.has(op.noteId)) this.queue.set(op.noteId, op);
    } catch { /* unreadable pending queue */ }
    if (this.queue.size) this.scheduleFlush();
  }

  hasPending(noteId: string): boolean { return this.queue.has(noteId) || this.inFlight.has(noteId); }
  pendingIds(): Set<string> { return new Set([...this.queue.keys(), ...this.inFlight.keys()]); }
  editVersions(): Map<string, number> { return new Map(this.versions); }

  constructor() {
    onSourceSave(() => this.flushForSignOut());
    onPreLogout(() => this.flushForSignOut());
    // Restore server-reachable flag from last session
    const stored = localStorage.getItem('kaizen-notes-server-ok');
    this.serverReachable = stored !== 'false';

    if (typeof window !== 'undefined') {
      window.addEventListener('online',  () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());

      // If we're already offline at startup, reflect that
      if (!navigator.onLine) {
        this.serverReachable = false;
        this.setStatus('offline');
      }

      // Periodic health check to detect server coming back up
      this.healthTimer = setInterval(() => this.checkHealth(), HEALTH_CHECK_INTERVAL_MS);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Queue an upsert (create or update). Call after localStorage is already written. */
  queueUpsert(payload: NotePayload): void {
    this.restorePending();
    this.versions.set(payload.id, (this.versions.get(payload.id) ?? 0) + 1);
    this.queue.set(payload.id, {
      kind: 'upsert',
      noteId: payload.id,
      payload,
      updatedAt: payload.updatedAt,
    });
    this.persistQueue();
    this.scheduleFlush();
  }

  /** Queue a delete. Call after localStorage is already updated. */
  queueDelete(noteId: string): void {
    this.restorePending();
    this.versions.set(noteId, (this.versions.get(noteId) ?? 0) + 1);
    this.queue.set(noteId, {
      kind: 'delete',
      noteId,
      updatedAt: Date.now(),
    });
    this.persistQueue();
    this.scheduleFlush();
  }

  /** Subscribe to status changes. Returns an unsubscribe function. */
  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    // Immediately emit current status
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  /** Current sync status (snapshot). */
  getStatus(): SyncStatus {
    return this.status;
  }

  /** Force an immediate flush attempt (e.g. on beforeunload). */
  flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    return this.flush();
  }

  async flushForSignOut(): Promise<void> {
    do { await this.flushNow(); } while (this.queue.size > 0 && this.serverReachable && this.status !== 'error');
    if (this.queue.size > 0 || this.status === 'error') throw new Error('Notes have not been saved to the local server');
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private setStatus(next: SyncStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.listeners.forEach((l) => l(next));
  }

  private scheduleFlush(): void {
    if (!this.serverReachable) {
      this.setStatus('offline');
      return;
    }
    this.setStatus('syncing');
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DEBOUNCE_MS);
  }

  private flush(): Promise<void> {
    if (this.activeFlush) return this.activeFlush;
    this.activeFlush = this.performFlush().finally(() => { this.activeFlush = null; });
    return this.activeFlush;
  }

  private async performFlush(): Promise<void> {
    if (this.isFlushing || this.queue.size === 0) return;
    if (!this.serverReachable) {
      this.setStatus('offline');
      return;
    }

    this.isFlushing = true;
    this.setStatus('syncing');

    // Snapshot the queue and clear it — new ops during flush go into a fresh queue
    const ops = [...this.queue.values()];
    this.queue.clear();
    this.inFlight = new Map(ops.map((op) => [op.noteId, op]));

    let anyError = false;
    let anyRejected = false;

    for (const op of ops) {
      try {
        if (op.kind === 'delete') {
          await this.apiDelete(op.noteId);
        } else if (op.payload) {
          await this.apiUpsert(op.payload);
        }
      } catch (e) {
        if (e instanceof NoteRejectedError) {
          // The server is up and refused this note. Keep it locally and stop
          // retrying it; a later edit is queued again as usual.
          anyRejected = true;
          if (!this.queue.has(op.noteId)) this.queue.set(op.noteId, op);
          console.warn(`[notes] server rejected note ${op.noteId}: ${e.message}`);
          continue;
        }
        anyError = true;
        // Re-queue failed op (only if a newer op hasn't replaced it)
        if (!this.queue.has(op.noteId)) {
          this.queue.set(op.noteId, op);
        }
      }
    }

    this.isFlushing = false;
    this.inFlight.clear();
    this.persistQueue();

    if (anyError) {
      this.serverReachable = false;
      localStorage.setItem('kaizen-notes-server-ok', 'false');
      this.setStatus(navigator.onLine ? 'error' : 'offline');
    } else if (anyRejected) {
      this.setStatus('error');
    } else if (this.queue.size > 0) {
      // More ops arrived during flush — schedule another round
      this.scheduleFlush();
    } else {
      this.serverReachable = true;
      localStorage.setItem('kaizen-notes-server-ok', 'true');
      this.setStatus(anyRejected ? 'error' : 'synced');
    }
  }

  private async apiUpsert(payload: NotePayload): Promise<void> {
    // Try PUT first (update), fall back to POST (create) on 404
    // Simple requests carrying the session cookie; see lib/simpleRequest.ts.
    const put = simpleRequest(`${API_BASE}/${payload.id}`, 'PUT', JSON.stringify(payload));
    const res = await fetch(put.url, { ...put.init, signal: AbortSignal.timeout(8000) });

    if (res.status === 404) {
      // Note doesn't exist on server yet — create it
      const create = simpleRequest(API_BASE, 'POST', JSON.stringify(payload));
      const createRes = await fetch(create.url, { ...create.init, signal: AbortSignal.timeout(8000) });
      if (!createRes.ok) throw await syncError('POST', createRes);
      return;
    }

    if (!res.ok) throw await syncError('PUT', res);
  }

  private async apiDelete(noteId: string): Promise<void> {
    const remove = simpleRequest(`${API_BASE}/${noteId}`, 'DELETE');
    const res = await fetch(remove.url, { ...remove.init, signal: AbortSignal.timeout(8000) });
    // 404 is fine — note was never on server or already deleted
    if (!res.ok && res.status !== 404) throw new Error(`DELETE ${res.status}`);
  }

  private async checkHealth(): Promise<void> {
    if (!navigator.onLine) return;
    try {
      const res = await fetch(HEALTH_URL, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok && !this.serverReachable) {
        this.serverReachable = true;
        localStorage.setItem('kaizen-notes-server-ok', 'true');
        // Drain any queued ops now that server is back
        if (this.queue.size > 0) {
          this.scheduleFlush();
        } else {
          this.setStatus('synced');
        }
      }
    } catch {
      // Server still unreachable — stay in current state
    }
  }

  private handleOnline(): void {
    void this.checkHealth();
  }

  private handleOffline(): void {
    this.serverReachable = false;
    localStorage.setItem('kaizen-notes-server-ok', 'false');
    this.setStatus('offline');
  }

  destroy(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    window.removeEventListener('online',  () => this.handleOnline());
    window.removeEventListener('offline', () => this.handleOffline());
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const notesSyncService = new NotesSyncService();
