import { describe, expect, it } from 'vitest';
import { simpleRequest } from '@/lib/simpleRequest';

const SIMPLE_CONTENT_TYPES = ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'];

/** What the browser checks before deciding it needs no preflight. */
function needsPreflight(init: RequestInit): boolean {
  if (!['GET', 'HEAD', 'POST'].includes(String(init.method))) return true;
  const headers = new Headers(init.headers);
  for (const [name, value] of headers) {
    if (name !== 'content-type') return true;
    if (!SIMPLE_CONTENT_TYPES.some((t) => value.toLowerCase().startsWith(t))) return true;
  }
  return false;
}

describe('simpleRequest', () => {
  it('leaves a GET alone apart from the timezone, with no headers', () => {
    const r = simpleRequest('https://api.example/api/tasks', 'GET', undefined, 'Asia/Kolkata');
    expect(r.url).toBe('https://api.example/api/tasks?tz=Asia%2FKolkata');
    expect(r.init.method).toBe('GET');
    expect(r.init.headers).toBeUndefined();
    expect(r.init.credentials).toBe('include');
  });

  it('sends PUT, PATCH and DELETE as POST with _method', () => {
    expect(simpleRequest('/api/tasks/1', 'PUT', '{}').url).toBe('/api/tasks/1?_method=PUT');
    expect(simpleRequest('/api/tasks/1/status', 'patch', '{}').url).toBe('/api/tasks/1/status?_method=PATCH');
    const del = simpleRequest('/api/tasks/1', 'DELETE');
    expect(del.url).toBe('/api/tasks/1?_method=DELETE');
    expect(del.init.method).toBe('POST');
    expect(del.init.body).toBeUndefined();
  });

  it('keeps an existing query string', () => {
    expect(simpleRequest('/api/tasks?listId=a', 'GET', undefined, 'UTC').url).toBe('/api/tasks?listId=a&tz=UTC');
  });

  it('sends a JSON body as text/plain', () => {
    const r = simpleRequest('/api/tasks', 'POST', '{"title":"x"}');
    expect(new Headers(r.init.headers).get('content-type')).toBe('text/plain;charset=UTF-8');
    expect(r.init.body).toBe('{"title":"x"}');
  });

  it('never produces a request the browser would preflight', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = simpleRequest('/api/x', method, method === 'GET' || method === 'DELETE' ? undefined : '{}', 'Asia/Kolkata');
      expect(needsPreflight(r.init), method).toBe(false);
    }
  });
});
