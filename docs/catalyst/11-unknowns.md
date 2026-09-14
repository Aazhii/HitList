# What is not established

Named so nobody fills the gap with a guess — and so a later reader knows the difference between
"this reference is silent" and "this reference says it does not happen".

If you establish any of these, move it into the relevant file as `[VERIFIED]` with the evidence.

---

## Limits we never hit

- **Rate limits.** Requests per second or per day, for the REST API or the SDK. Nothing in the
  documentation we have, and we never generated enough load to find out. We *did* hit throttling
  on **token refreshes** — `400` with an HTML body — but never on data operations.
- **Row size limits** in bytes, and the maximum number of columns per table.
- **Maximum rows per `insertRows()` call.** `deleteRows()` is documented at 200 `[DOCS]`; the
  insert side is not.
- **Request payload size caps.**

The documented limits we *do* have: development caps at 5,000 rows per table, 25,000 per
project, and 25 app users. Production is stated as uncapped.

---

## ZCQL

- **The grammar.** Supported operators, joins, subqueries, `LIMIT`/`OFFSET` semantics, ordering.
  We used `SELECT … WHERE … LIMIT` and nothing else.
- **Parameterised queries.** We found no binding mechanism, which is why
  [03-datastore](03-datastore.md#escaping) escapes literals by hand. If one exists, it should
  replace that entirely.
- **`executeOLAPQuery` and `executeSearchQuery`** — documented `[DOCS]`, never run here.

---

## Reserved words

We know `Priority` is a reserved **column** name because Catalyst rejected it with
`INVALID_OPERATION`. We do not have the list. Nor do we know whether table names have their own
reserved set.

Likewise for environment variables: `CATALYST_` and `NODE_` prefixes are rejected by AppSail
`[VERIFIED]`, but whether other prefixes are reserved is unknown.

---

## Authentication

- **Toggling public signup programmatically.** Documented as console-only `[DOCS]`, and we
  found no API. Whether the MCP server can do it is untested.
- **Production vs Development ZAID.** The documentation calls this the number-one cause of auth
  breaking after promotion `[DOCS]` — the ZAID differs between environments, and social logins
  configured in Development must be reconfigured. We only ever ran in Development, so we have
  not exercised the promotion path at all. **Treat any promotion to Production as unproven
  territory.**
- **Social logins, third-party IdPs, `signinWithJwt`, `generateCustomToken`.** Documented
  `[DOCS]`; not used.
- **MFA / OTP step behaviour in the embedded form.** Catalyst's stylesheet contains containers
  for OTP, TOTP, QR, backup codes and recovery, and our theme keeps them scrollable — but we
  never had MFA enabled, so those steps were never rendered. The iframe height was tuned against
  the email and password steps only, and an MFA step may well need more.

---

## The embedded login form

- **The DOM structure**, beyond the selectors visible in the published stylesheet. We styled
  against the stylesheet rather than the markup.
- **Whether `css_url` is fetched by the browser or by Catalyst's server.** It works when served
  from our own origin; we did not test a cross-origin stylesheet.
- **`forgot_password_css_url`** takes the same base-plus-theme treatment with
  `embedded_password_reset.css` `[DOCS]`, but we never wired it — so the password-reset screen
  in this project is unstyled.

---

## Platform behaviour

- **Whether AppSail ever runs `npm install`** under some configuration. We observed that it does
  not on a managed Node runtime `[VERIFIED]`, and that the **Slate** deployer does `[VERIFIED]`.
  Whether a Docker runtime or a different stack differs is unknown.
- **AppSail runtime logs.** We found no way to read them through the CLI or the REST endpoints
  we tried, which is why the nine-line probe in [10-recipes](10-recipes.md) exists. They may be
  available in the console.
- **The `/baas/*` proxy under Functions rather than AppSail.** `api_domain: ""` was observed in
  AppSail's `init.js` `[VERIFIED]`; whether Functions or Slate serve the same is untested.
- **Bulk jobs**, `getIterableRows()`, and the modular `@zcatalyst/datastore` package generally —
  documented `[DOCS]`, never run.

---

## Scheduling and delivery — what is now known

Crons targeting AppSail, the email sender requirement and web-push recipients were established
and moved to [12-scheduling-and-delivery](12-scheduling-and-delivery.md). What remains open
there:

- **Whether a web push actually renders in a browser.** The API accepts and returns
  `{"data": true}`, but that only proves acceptance. Browser permission and Web SDK push
  registration are untested.
- **Cron execution limits** — minimum interval, timeout per invocation, and any quota.
- **The SDK's `queue` module**, which exists in `lib/` but appears in no bundled documentation.

---

## Everything in [07-other-services](07-other-services.md)

Functions, Cache, Stratus, NoSQL, Signals, Zia, SmartBrowz. All of it is `[DOCS]`. We used Data
Store, authentication and AppSail, and nothing else.

---

## One claim in this set that is reasoned rather than observed

`[UNKNOWN]` The CLI token-refresh recovery path in
[01-credentials](01-credentials.md#the-token-expiry-trap) — memoise, then force one refresh on
rejection. Each fault was verified in isolation (the cached-token behaviour, the throttling),
but the end-to-end recovery on a cold start was never confirmed. It is reasoned-through rather
than observed. Worth watching the first time a local server starts with an expired token.
