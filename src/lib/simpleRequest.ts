/**
 * Shapes a call to the API as a CORS "simple request", so the browser sends it
 * straight away instead of asking permission with a preflight first.
 *
 * Why: split-origin deployments still exist during local development and
 * previews, and some reverse proxies respond to OPTIONS themselves. Keeping API
 * calls "simple requests" avoids a preflight before the real request.
 *
 * A request needs no preflight when it uses GET, HEAD or POST, sets no custom
 * headers, and has a Content-Type of text/plain (or a form type). So:
 *   - PUT, PATCH and DELETE go as POST with `?_method=<METHOD>`;
 *   - the timezone goes as `?tz=` instead of an X-Timezone header;
 *   - JSON bodies go as text/plain, which the backend parses as JSON.
 * The backend maps all three back.
 */
const SIMPLE_METHODS = new Set(['GET', 'HEAD', 'POST']);

export function simpleRequest(
  url: string,
  method: string = 'GET',
  body?: string,
  timeZone?: string,
): { url: string; init: RequestInit } {
  const upper = method.toUpperCase();
  const params: string[] = [];
  if (!SIMPLE_METHODS.has(upper)) params.push(`_method=${encodeURIComponent(upper)}`);
  if (timeZone) params.push(`tz=${encodeURIComponent(timeZone)}`);

  const joined = params.length ? `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}` : url;

  return {
    url: joined,
    init: {
      method: SIMPLE_METHODS.has(upper) ? upper : 'POST',
      ...(body !== undefined ? { body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } } : {}),
      // Keep cookies enabled for same-origin requests and any split-origin
      // deployment that still relies on browser-managed credentials.
      credentials: 'include',
    },
  };
}
