# Authentication and the embedded login form

Catalyst issues sessions to **app users**. The browser proves identity with a session cookie;
your server reads the same identity through the Node SDK, so the two agree without your code
being trusted.

`[VERIFIED]` observed here · `[DOCS]` official, untested · `[DOCS-WRONG]` docs disagree with
observation · `[UNKNOWN]` not established.

Reference: [`src/lib/catalystAuth.ts`](../../src/lib/catalystAuth.ts),
[`src/components/CatalystAuthGate.tsx`](../../src/components/CatalystAuthGate.tsx).

---

## App users versus collaborators

`[DOCS]` `[VERIFIED]` The console account that owns the project is a **collaborator**, not an
app user. `getCurrentUser()` returns `null` for collaborators.

A new project has **zero app users**, so authentication appears completely broken until one
exists and has confirmed their invitation. Check before debugging anything else:

```bash
curl -s -H "Authorization: Zoho-oauthtoken $TOKEN" \
     -H "CATALYST-ORG: 60084215173" -H "Environment: Development" \
     "https://api.catalyst.zoho.in/baas/v1/project/69251000000061001/project-user"
```

An `ACTIVE` user with `is_confirmed: true` can sign in. One with `is_confirmed: false` cannot,
no matter how correct your code is.

`[VERIFIED]` A user created with a typo'd email address is a perfectly valid unconfirmed user
whose confirmation mail goes nowhere. "No mail arrived" is more often a typo than a bug — check
the stored address before suspecting the platform.

`[DOCS]` Development caps at **25 app users**.

### Prerequisites you cannot do from code

`[DOCS]` Two console-only settings, and both fail *silently* when unset:

1. **Authentication enabled** on the project.
2. **Allow Public Signup** — Console → Authentication → Settings. Until this is on,
   `catalyst.auth.signUp()` fails for new users with no useful error. There is no API for it.

---

## Loading the Web SDK

`[VERIFIED]` Two scripts, in this order. `init.js` depends on globals the bundle defines, and
loading it first throws `Uncaught ReferenceError: I18N is not defined`.

```html
<script src="https://static.zohocdn.com/catalyst/sdk/js/4.6.0/catalystWebSDK.js"></script>
<script src="/__catalyst/sdk/init.js"></script>
```

`/__catalyst/sdk/init.js` is served by Catalyst hosting and supplies the project id and ZAID.
It **404s in local dev**, so guard every SDK call on readiness rather than assuming
`window.catalyst` is usable.

`[VERIFIED]` On AppSail it returns real credentials — and one field that changes everything:

```js
catalyst.initApp({
  project_Id : "69251000000061001",
  zaid       : "50045863073",
  auth_domain: "https://accounts.zohoportal.in",
  is_appsail : true,
  api_domain : ""            // ← empty means "same origin"
}, { org_id: "60084215173" });
```

---

## The `/baas/*` proxy — required on AppSail

`[VERIFIED]` Because `api_domain` is empty, **every Web SDK call is issued against your own
server**, not against Catalyst. If your server has no `/baas` routes, the SPA catch-all answers
with `index.html`, and the SDK reports the unexpected HTML as `server://net-issue` code 700.

That is the error you get from `catalyst.auth.isUserAuthenticated()` on AppSail with no proxy.

Forward `/baas/*` upstream, registered **before** any SPA catch-all:

```ts
app.use('/baas', baasProxy());   // → server/catalyst/baasProxy.ts
```

Verified before and after:

```
GET /baas/v1/project/…/project-user
  before: 200 text/html            (the SPA — the SDK cannot parse this)
  after:  401 application/json AUTHENTICATION_FAILURE
          (a real Catalyst response, and correct for an unauthenticated request)
```

### Three rules for writing that proxy

A proxy is exactly where this goes wrong, so:

1. **Fix the target host.** Only path and query pass through. Never let the client choose where
   you forward to.
2. **Strip inbound `x-zc-*` and `x-catalyst-*`.** `[VERIFIED]` The AppSail gateway injects
   these on *every* request, including anonymous ones, and they carry **admin-scope
   credentials**. Relaying them hands any caller the project's admin rights through your own
   server. Verified: a request with forged `x-zc-projectid` / `x-zc-project-key` still returns
   401 rather than admin data.
3. **Do not forward the client's `Authorization`.** Cookies pass both ways — that is the
   session being authenticated. Use `getSetCookie()` when relaying responses, since `Set-Cookie`
   can repeat.

Implementation: [`server/catalyst/baasProxy.ts`](../../server/catalyst/baasProxy.ts).

---

## Client API

```js
// Is anyone signed in? RESOLVES with the user, REJECTS (401) when not.
const res = await catalyst.auth.isUserAuthenticated();
const user = res.content;   // user_id, email_id, first_name, last_name, role_details…

// Render Catalyst's login form into an element you provide
catalyst.auth.signIn('login-container', { service_url: '/' });

// Sign up — your own form; the widget has no signup path
await catalyst.auth.signUp({
  first_name: 'Ada', last_name: 'Lovelace', email_id: 'ada@example.com',
  platform_type: 'web',
  redirect_url: window.location.origin + '/',
});

catalyst.auth.signOut(window.location.origin);
```

`[DOCS]` `redirect_url` must be `/` (root) for Slate — `/app/index.html` paths are a legacy
pattern that 404s.

`[VERIFIED]` The embedded widget **renders a login form only**. There is no sign-up button
inside it; you build that form yourself and call `signUp()`.

`[VERIFIED]` Catalyst returns the user to your app after login rather than through a callback,
so re-check the session on window focus instead of waiting for an event.

`[VERIFIED]` API calls to your own server need `credentials: 'include'`. The default
(`same-origin`) works on AppSail but silently drops the session cookie on a cross-origin
frontend, making every request a 401. And `cors({ origin: '*' })` is incompatible with
credentialed requests — the browser will not attach the cookie at all, so an allowlist is
required, not merely tidier.

### Error code 700

`[VERIFIED]` The SDK reports **every non-2xx as `server://net-issue` code 700** — including an
ordinary signed-out 401.

```
Uncaught e {name: 'server://net-issue', message: 'Some network issue occured!', code: 700}
```

So the code tells you nothing about the cause. Read the **network tab** instead: the underlying
request's status and content-type are what distinguish "not signed in" (401 JSON) from
"the SDK is talking to the wrong place" (200 text/html).

This one error is why several problems in this project looked identical while having entirely
different causes.

---

## Styling the form

The form renders in an iframe on Catalyst's domain. Page CSS cannot reach inside it. The
`css_url` option is the only way in.

### css_url replaces, it does not cascade

`[VERIFIED]` **`css_url` replaces Catalyst's stylesheet entirely.** Their sheet is what drives
the form's state machine — it carries the `display: none` rules that hide the steps which are
not current. Supply a theme written from scratch and you get the email step, "Sign in using
OTP", "Forgot Password?", "Change" and the OTP field **all rendered at once**, stacked and
overflowing.

`[DOCS]` Catalyst's own instruction: *"begin styling your login element after the last line of
code"* and *"do not alter the code that is already present."*

### The base sheet is published

`[VERIFIED]` You do not need the console or the iframe's markup:

```
https://api.catalyst.zoho.com/baas/v1/auth/static-file?file_name=embedded_signin.css
```

30,030 bytes, 20 `display: none` rules, byte-identical from the `.com` and `.in` hosts. Also
published: `embedded_signin_providers_only.css`, `embedded_password_reset.css`,
`confirm_password.css`.

Build your sheet as **base + theme**:

```bash
{
  echo "@import url('https://fonts.googleapis.com/css2?family=…');"   # @import must be first
  curl -fsSL "$BASE_URL"
  cat styles/my-theme.css
} > public/catalyst-login.css
```

Script: [`scripts/build-login-css.sh`](../../scripts/build-login-css.sh). Re-run it when
Catalyst updates the sheet; never hand-edit above the theme block.

### Four things in the real source

`[VERIFIED]` Each confirmed by reading the file, line numbers re-checked against a fresh
download:

| Line | What | Why it matters |
|---|---|---|
| 701 | The big `display: none` group — `#otp_container`, `#enableotpoption`, `#mfa_*`, `#recovery_container`, and more | Lose these and every step renders at once |
| 1421 | `#login_id { text-indent: 0 !important }` | The base indents other fields with `text-indent`; set horizontal space as **padding** or the two fields disagree |
| 1263 | `.textbox` inside `@media (max-width: 600px)` | The iframe is ~400px wide so **this block always applies**, stripping fields to bottom-border-only. Re-assert inside the same query or your styles look ignored |
| 231, 325 | `.show_hide_password { position: relative; top: -39px }` | Positioned against a 44px field; change the height and the eye icon leaves the input |

`.signin_head` deserves its own note. It is not only the "Sign in" title — Catalyst reuses it
for the OTP, recovery and password-expiry steps. Hiding it as a duplicate strands those screens
without a heading. We hide it anyway, having judged those steps legible from their fields and
links, but that is a trade rather than a free win.

### The iframe has no intrinsic height

`[VERIFIED]` It renders invisible without an explicit height, and **a `min-height` on the
container does not help** — the iframe itself still collapses to zero. Set a real height on the
iframe element.

`[VERIFIED]` Catalyst's own box metrics fight this: `.signin_container` has `min-height: 520px`
globally plus `margin-top: 40px` inside that always-applied mobile query, and `.signin_box` has
`min-height: 520px`, `padding: 50px` and `overflow-y: auto`. Left standing, the content is 520px
tall and offset downward inside a shorter iframe — so the iframe scrolls internally and the
email field ends up above the fold, leaving a card that shows only a button.

Override those box metrics (`!important` is needed; this is one of the few places it is
justified), and set the iframe document to `overflow: hidden`.

`[VERIFIED]` The iframe is cross-origin, so **you cannot measure its content height or detect a
step change**. Steps differ by ~80px. Centring with `justify-content: safe center` spreads the
slack; `safe` matters because it falls back to flex-start when content overflows, so a tall step
runs off the bottom — where the field and button remain reachable — instead of being clipped at
both ends.

Keep the recovery and MFA option lists scrollable (`overflow-y: auto`) — they are genuinely
long and hiding their overflow cuts options off.

---

## Verifying the form

Paint is the easy part. **The step transitions are the real test**, because that is what a
broken stylesheet destroys:

1. Load → only the email field, NEXT and Forgot Password are visible.
2. Enter a real email → the password step appears and the email field is **gone**, not stacked
   above it.
3. Click **Change** → back to the email step.
4. Submit a wrong password → the error appears under the field and **nothing else** becomes
   visible.

Any two steps on screen at once means a `display` rule was lost — diff your generated file
against the base URL.
