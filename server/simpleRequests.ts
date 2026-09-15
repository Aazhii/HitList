/**
 * The server half of src/lib/simpleRequest.ts.
 *
 * The Slate client sends every API call as a CORS "simple request", because
 * Catalyst's AppSail gateway answers OPTIONS preflights itself with no CORS
 * headers and the browser then blocks the call. This maps the workarounds
 * back:
 *
 *   POST ?_method=PUT|PATCH|DELETE  → that method, so the existing routes match
 *   ?tz=<zone>                      → the X-Timezone header the routes read
 *
 * And it restores the protection a preflight used to give. A simple request
 * reaches the server even from a site that is not allowed — CORS only stops
 * that site reading the answer — so a state-changing request whose Origin is
 * not allowed is refused here, before anything runs. Requests with no Origin
 * (the Catalyst cron, curl, server-to-server) and same-host requests pass.
 */
import type { NextFunction, Request, Response } from 'express';

const OVERRIDABLE = new Set(['PUT', 'PATCH', 'DELETE']);
const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS']);

export function simpleRequestMiddleware(isAllowedOrigin: (origin: string) => boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const query = req.query as Record<string, unknown>;

    const override = typeof query['_method'] === 'string' ? query['_method'].toUpperCase() : '';
    if (req.method === 'POST' && OVERRIDABLE.has(override)) req.method = override;

    if (typeof query['tz'] === 'string' && !req.headers['x-timezone']) {
      req.headers['x-timezone'] = query['tz'];
    }

    const origin = req.headers.origin;
    if (origin && !READ_ONLY.has(req.method) && !isAllowedOrigin(origin) && !isSameHost(origin, req)) {
      res.status(403).json({ error: 'forbidden_origin', message: 'This origin may not change data' });
      return;
    }
    next();
  };
}

function isSameHost(origin: string, req: Request): boolean {
  try {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
    return !!host && new URL(origin).host.replace(/\.$/, '') === host.replace(/\.$/, '');
  } catch {
    return false;
  }
}
