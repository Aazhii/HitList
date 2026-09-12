/**
 * Notes API client — mirrors the Spring Boot /api/notes endpoints.
 * Uses the same BASE_URL pattern as src/lib/api.ts.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?? 'http://localhost:8080/api';

// ── Wire types ────────────────────────────────────────────────────────────────

/** Shape returned by the server for every note. */
export interface ApiNote {
  id: string;
  title: string;
  blocksJson: string | null;
  emoji: string | null;
  pinned: boolean;
  createdAt: number; // epoch-ms
  updatedAt: number; // epoch-ms
}

export interface NoteCreateRequest {
  title: string;
  blocksJson: string;
  emoji?: string;
  pinned?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export type NoteUpdateRequest = Partial<NoteCreateRequest>;

// ── Core fetch helper ─────────────────────────────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.message ?? body.error ?? message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ── Notes API ─────────────────────────────────────────────────────────────────

export const notesApi = {
  /** GET /api/notes — pinned first, then by updatedAt desc */
  list(): Promise<ApiNote[]> {
    return request<ApiNote[]>('/notes');
  },

  /** GET /api/notes/{id} */
  get(id: string): Promise<ApiNote> {
    return request<ApiNote>(`/notes/${id}`);
  },

  /** POST /api/notes */
  create(req: NoteCreateRequest): Promise<ApiNote> {
    return request<ApiNote>('/notes', { method: 'POST', body: JSON.stringify(req) });
  },

  /** PUT /api/notes/{id} — full update */
  update(id: string, req: NoteUpdateRequest): Promise<ApiNote> {
    return request<ApiNote>(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(req) });
  },

  /** DELETE /api/notes/{id} */
  delete(id: string): Promise<void> {
    return request<void>(`/notes/${id}`, { method: 'DELETE' });
  },
};
