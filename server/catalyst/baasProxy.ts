/**
 * Proxies Catalyst's own REST API (/baas/*) through to the platform.
 *
 * Why this has to exist on AppSail:
 *
 * The Catalyst Web SDK is configured by /__catalyst/sdk/init.js, which AppSail
 * serves with `api_domain: ""`. Empty means "same origin", so every SDK call —
 * including the whole authentication flow — is issued against this server
 * rather than api.catalyst.zoho.*. Express has no /baas routes, the SPA
 * catch-all answers with index.html, and the SDK reports the HTML it did not
 * expect as `server://net-issue` code 700.
 *
 * Forwarding those requests upstream is what makes embedded Catalyst
 * authentication work on AppSail.
 *
 * Security notes, because a proxy is exactly where this goes wrong:
 *
 *  - The target host is fixed to this project's Catalyst API. The client
 *    cannot influence it; only the path and query are passed through.
 *  - Inbound x-zc-* headers are STRIPPED. The AppSail gateway injects those on
 *    every request, including anonymous ones, and they carry admin-scope
 *    credentials — forwarding them would hand any caller the project's admin
 *    rights through our own server.
 *  - Likewise Authorization is not forwarded from the client.
 *  - Cookies are passed through in both directions, because that is the
 *    session the SDK is actually authenticating with.
 */
import type express from 'express';
import { REGION } from './region.ts';

/** Headers we must not relay upstream. */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'authorization',
]);

/** Headers that belong to our own response, not the upstream one. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

function isGatewayHeader(name: string): boolean {
  // x-zc-* carry the gateway's admin credentials; x-catalyst-* are internal too.
  return name.startsWith('x-zc-') || name.startsWith('x-catalyst-');
}

export function baasProxy(): express.RequestHandler {
  return async (req, res) => {
    const target = `${REGION.consoleUrl}${req.originalUrl}`;

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      const lower = name.toLowerCase();
      if (STRIPPED_REQUEST_HEADERS.has(lower) || isGatewayHeader(lower)) continue;
      if (typeof value === 'string') headers[name] = value;
      else if (Array.isArray(value)) headers[name] = value.join(', ');
    }

    // express.json() has already consumed the body, so re-serialise it.
    let body: string | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!headers['content-type']) headers['content-type'] = 'application/json';
    }

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
      });

      for (const [name, value] of upstream.headers.entries()) {
        if (STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
        if (name.toLowerCase() === 'set-cookie') continue; // handled below
        res.setHeader(name, value);
      }

      // Set-Cookie may repeat; getSetCookie preserves each one separately.
      const cookies = upstream.headers.getSetCookie?.() ?? [];
      if (cookies.length) res.setHeader('set-cookie', cookies);

      res.status(upstream.status);
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.end(buffer);
    } catch (e) {
      console.error(`[kaizen] /baas proxy failed for ${req.method} ${req.originalUrl}:`, e);
      res.status(502).json({
        error: 'upstream_unavailable',
        message: 'Could not reach the Catalyst API',
      });
    }
  };
}
