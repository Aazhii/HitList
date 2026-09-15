import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { simpleRequestMiddleware } from '../../server/simpleRequests.ts';

const ALLOWED = 'https://hitlist.onslate.in';
const middleware = simpleRequestMiddleware((o) => o === ALLOWED);

function run(req: Partial<Request>) {
  const full = { method: 'GET', query: {}, headers: {}, ...req } as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  middleware(full, res, next);
  return { req: full, res, next };
}

describe('simpleRequestMiddleware', () => {
  it('turns POST ?_method=PUT back into PUT', () => {
    const { req, next } = run({ method: 'POST', query: { _method: 'put' }, headers: { origin: ALLOWED } });
    expect(req.method).toBe('PUT');
    expect(next).toHaveBeenCalled();
  });

  it('ignores _method on anything but POST, and methods that are not overridable', () => {
    expect(run({ method: 'GET', query: { _method: 'DELETE' } }).req.method).toBe('GET');
    expect(run({ method: 'POST', query: { _method: 'CONNECT' }, headers: { origin: ALLOWED } }).req.method).toBe('POST');
  });

  it('reads the timezone from ?tz, without overriding a real header', () => {
    expect(run({ query: { tz: 'Asia/Kolkata' } }).req.headers['x-timezone']).toBe('Asia/Kolkata');
    expect(run({ query: { tz: 'UTC' }, headers: { 'x-timezone': 'Asia/Kolkata' } }).req.headers['x-timezone']).toBe('Asia/Kolkata');
  });

  it('refuses a change from an origin that is not allowed', () => {
    const { res, next } = run({ method: 'POST', query: { _method: 'DELETE' }, headers: { origin: 'https://evil.example' } });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets reads from any origin through — CORS decides whether they can be read', () => {
    expect(run({ method: 'GET', headers: { origin: 'https://evil.example' } }).next).toHaveBeenCalled();
  });

  it('lets through requests with no Origin (cron, curl) and same-host requests', () => {
    expect(run({ method: 'POST' }).next).toHaveBeenCalled();
    const same = run({ method: 'POST', headers: { origin: 'https://api.example.in', host: 'api.example.in' } });
    expect(same.next).toHaveBeenCalled();
  });
});
