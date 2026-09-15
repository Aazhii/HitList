/**
 * Shapes a call to the API as a CORS "simple request", so the browser sends it
 * straight away instead of asking permission with a preflight first.
 *
 * Why: the Slate client calls the AppSail API on another origin, and Catalyst's
 * AppSail gateway answers every OPTIONS preflight itself — 200, empty, no CORS
 * headers — without passing it to the server. The browser then blocks the real
 * request. Verified: the same preflight against the server run locally returns
 * 204 with every CORS header; through AppSail it returns 200 with none.
 *
 * A request needs no preflight when it uses GET, HEAD or POST, sets no custom
 * headers, and has a Content-Type of text/plain (or a form type). So:
 *   - PUT, PATCH and DELETE go as POST with `?_method=<METHOD>`;
 *   - the timezone goes as `?tz=` instead of an X-Timezone header;
 *   - JSON bodies go as text/plain, which the server parses as JSON.
 * The server maps all three back — see server/simpleRequests.ts.
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
      // The server identifies the caller from their Catalyst session cookie.
      credentials: 'include',
    },
  };
}
