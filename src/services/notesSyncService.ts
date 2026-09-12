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

const API_BASE = '/api/notes'; // proxied by Vite → localhost:3001
const HEALTH_URL = '/api/health';
const FLUSH_DEBOUNCE_MS = 600;
const HEALTH_CHECK_INTERVAL_MS = 15_000;

// ── Service ───────────────────────────────────────────────────────────────────

class NotesSyncService {
  private queue = new Map<string, QueuedOp>(); // noteId → latest op
  private status: SyncStatus = 'synced';
  private listeners = new Set<StatusListener>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;
  private serverReachable = true;

  constructor() {
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
    this.queue.set(payload.id, {
      kind: 'upsert',
      noteId: payload.id,
      payload,
      updatedAt: payload.updatedAt,
    });
    this.scheduleFlush();
  }

  /** Queue a delete. Call after localStorage is already updated. */
  queueDelete(noteId: string): void {
    this.queue.set(noteId, {
      kind: 'delete',
      noteId,
      updatedAt: Date.now(),
    });
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
  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flush();
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

  private async flush(): Promise<void> {
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

    let anyError = false;

    for (const op of ops) {
      try {
        if (op.kind === 'delete') {
          await this.apiDelete(op.noteId);
        } else if (op.payload) {
          await this.apiUpsert(op.payload);
        }
      } catch {
        anyError = true;
        // Re-queue failed op (only if a newer op hasn't replaced it)
        if (!this.queue.has(op.noteId)) {
          this.queue.set(op.noteId, op);
        }
      }
    }

    this.isFlushing = false;

    if (anyError) {
      this.serverReachable = false;
      localStorage.setItem('kaizen-notes-server-ok', 'false');
      this.setStatus(navigator.onLine ? 'error' : 'offline');
    } else if (this.queue.size > 0) {
      // More ops arrived during flush — schedule another round
      this.scheduleFlush();
    } else {
      this.serverReachable = true;
      localStorage.setItem('kaizen-notes-server-ok', 'true');
      this.setStatus('synced');
    }
  }

  private async apiUpsert(payload: NotePayload): Promise<void> {
    // Try PUT first (update), fall back to POST (create) on 404
    const res = await fetch(`${API_BASE}/${payload.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 404) {
      // Note doesn't exist on server yet — create it
      const createRes = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      if (!createRes.ok) throw new Error(`POST ${createRes.status}`);
      return;
    }

    if (!res.ok) throw new Error(`PUT ${res.status}`);
  }

  private async apiDelete(noteId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/${noteId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(8000),
    });
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
