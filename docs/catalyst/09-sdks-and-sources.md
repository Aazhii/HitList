# SDKs, and where to look when this reference falls short

These files cover what we exercised. When something is missing, these are the authoritative
sources — in the order worth consulting them.

`[VERIFIED]` observed here · `[DOCS]` official, untested · `[UNKNOWN]` not established.

---

## 1. Catalyst's own shipped files — highest authority

Not documentation *about* Catalyst; Catalyst itself. Citable by line number, and it settled
several questions no documentation answered.

### The SDK source

```
node_modules/zcatalyst-sdk-node/lib/
  catalyst-namespace.js        initialize() / initializeApp(), the init-type dispatch
  catalyst-app.js              header construction, 'Zoho-oauthtoken ' + token
  utils/constants.js           x-zc-* header names, CATALYST_CONFIG env key, DC defaults
  utils/credential.js          RefreshToken / AccessToken / Ticket credential classes
```

`[VERIFIED]` Reading these answered: why `initialize({})` throws, which headers carry project
credentials, that the API host is resolved once at module load, and that a duck-typed
credential is accepted and then ignored. All four are undocumented.

```bash
grep -rn "unable to find the type of initialisation" node_modules/zcatalyst-sdk-node/lib/
```

### The published stylesheets

```
https://api.catalyst.zoho.com/baas/v1/auth/static-file?file_name=embedded_signin.css
                                                        embedded_signin_providers_only.css
                                                        embedded_password_reset.css
                                                        confirm_password.css
```

`[VERIFIED]` 30,030 bytes, byte-identical across the `.com` and `.in` hosts. This is the real
markup contract for the embedded login form — the selectors, the state machine, the mobile
query. See [04-auth-embedded](04-auth-embedded.md#the-base-sheet-is-published).

### The CLI

```
$(npm root -g)/zcatalyst-cli/lib/authentication/credential.js
```

`[VERIFIED]` Where `catalyst login`'s grant is decrypted. Reaching into it is how local tooling
authenticates without a second set of credentials.

---

## 2. The bundled agent skills

~10,000 lines of official Catalyst documentation, installable and greppable:

```bash
npx skills add catalystbyzoho/agent-skills
```

Installs into `.agents/skills/` (symlinked for Claude Code):

| Skill | Lines | Covers |
|---|---|---|
| `catalyst-basics` | 1,860 | Project structure, `.catalystrc`, `catalyst.json`, environments, the full CLI reference, all the ID types |
| `catalyst-sdk` | 1,500 | Node, Web, Python, Java, Android, iOS, Flutter — init patterns and method reference |
| `catalyst-functions` | 1,247 | All 7 function types, `catalyst-config.json`, Security Rules, API Gateway, file uploads |
| `catalyst-smartbrowz` | 851 | Headless browsers, PDF/screenshot, Browser Logic |
| `catalyst-signals` | 632 | Event bus, publishers, dispatch policies |
| `catalyst-authentication` | 581 | Login flows, ZAID, embedded vs hosted, social logins, `signinWithJwt` |
| `catalyst-stratus` | 467 | Object storage, signed URLs, multipart |
| `catalyst-slate` | 425 | Frontend hosting, `slate-config.toml`, framework detection |
| `catalyst-zoho-mcp` | 395 | Managing infrastructure through MCP tools |
| `catalyst-datastore` | 388 | ZCQL, CRUD, permissions, pagination |
| `catalyst-zia` | 271 | OCR, ML, AutoML, and the DC restrictions |
| `catalyst-pricing` | 237 | Free tier, rates, GB-seconds |
| `catalyst-nosql` | 139 | Key-value tables |
| `catalyst-cache` | 123 | Segments and TTL |
| `catalyst-appsail` | 618 | Managed runtimes, Docker, `app-config.json` |

```bash
grep -rn "signinWithJwt" .agents/skills/catalyst-authentication/
```

`[VERIFIED]` These are good, and more specific than the public docs — the AppSail
absolute-`--build-path` requirement was documented only here. But they are not exhaustive: the
Data Store bundle contains **no** `zcatalyst-sdk-node` initialisation section at all, which is
the gap that cost the most time in this project.

---

## 3. The Catalyst MCP server

```bash
npx add-mcp https://catalyst.zohomcp.in/mcp/message
```

`[DOCS]` Exposes `CatalystbyZoho_*` tools for managing infrastructure conversationally —
`Create_Table`, `Create_Column`, `List_All_Tables`, `Update_Table_Permissions`, `Insert_Rows`,
`Get_Rows`, `Add_User`, `List_All_Roles`, `Enable_Authentication`.

`[UNKNOWN]` We registered it but never used it — the CLI and REST covered everything. It is
likely the shortest path for one-off schema work, and the only programmatic route to some
settings, but we cannot vouch for it.

Note the MCP tool payloads use lowercase wire types (`varchar`, `bigint`) and **string**
booleans (`"true"`), matching the REST API rather than the console's display names.

---

## 4. SDK surface by language

`[DOCS]` except where marked. Full reference in `catalyst-sdk`.

### Node — `zcatalyst-sdk-node`

Use `^2.5.0` or later; earlier versions are deprecated and `[DOCS]` return HTTP 500 from Data
Store with no useful message. This project runs `3.4.0`. Covered in
[02-node-sdk](02-node-sdk.md).

### Web — `catalystWebSDK.js`

A global bundle, not an npm package. Loaded from the CDN with
`/__catalyst/sdk/init.js` after it. Entry point is `window.catalyst`.

```js
catalyst.auth.signIn(divId, config)
catalyst.auth.signUp({ first_name, last_name, email_id, platform_type, redirect_url })
catalyst.auth.isUserAuthenticated()      // rejects 401 when signed out
catalyst.auth.signOut(redirectUrl)

var table = catalyst.table.tableId('KaizenTasks');
table.addRow([{ … }]);                   // an ARRAY, and named addRow, not insertRow
table.updateRow([{ …, ROWID }]);         // an ARRAY
table.deleteRow(rowId);
// results arrive under response.content
```

> `[VERIFIED]` **The Web and Node surfaces differ in ways that break copied code.** Web uses
> `catalyst.table` / `tableId()` / `addRow()` and returns `response.content`; Node uses
> `app.datastore()` / `table()` / `insertRow()` and resolves directly to the row. Web's
> `updateRow(rowId, data)` takes the id as a separate argument; Node's carries `ROWID` inside
> the object. This repo had two clients that had drifted apart for exactly this reason.

### `@zcatalyst/datastore` — the modular SDK

`[DOCS]` Tree-shakeable TypeScript, `v0.0.3-beta`, Node ≥20. Described as the recommended
approach for new projects. Browser use **requires** `@zcatalyst/auth` sign-in first, or every
request returns `401 authentication_error`.

```ts
import { Datastore } from '@zcatalyst/datastore';
const datastore = new Datastore(app);          // or new Datastore() inside a function
for await (const row of datastore.table('Employees').getIterableRows()) { … }
await datastore.executeZCQLQuery('SELECT … ');
```

Adds `getIterableRows()`, `deleteRows()`, `getAllColumns()`, `getAllTables()` and bulk jobs
(Node/admin only). Throws `CatalystDataStoreError` with `message` and `statusCode`; note
`table('')` throws **synchronously**, so it can escape an async handler's try/catch if you build
the reference outside the `await`.

### Python, Java, mobile

`[DOCS]` `catalyst-sdk` covers Python, Java, Android, iOS and Flutter. Same concepts —
`app.datastore()`, `app.zcql()`, `app.cache()` — with language-idiomatic naming.

---

## 5. Official documentation

- <https://docs.catalyst.zoho.com> — main documentation
- <https://docs.catalyst.zoho.com/en/cli/v1/cli-command-reference/> — CLI reference
- <https://api-console.zoho.com> — OAuth clients and refresh tokens

`[VERIFIED]` Worth knowing the shape of its gaps, since they are consistent:

- **Initialisation outside a hosted function is not covered.** Every Node sample starts from an
  ambient `app`.
- **REST payload shapes for row writes are wrong** — `{data: […]}` is rejected.
- **Rate limits, row-size limits and the ZCQL grammar are absent.**
- Platform-specific behaviour (AppSail not running `npm install`, reserved env prefixes,
  reserved column names) is largely undocumented.

When the docs and the platform disagree, the platform wins — and the way to find out is to
probe it. Several entries in these files came from sending the same request three ways and
seeing which returned 200.

---

## Promoting a claim

If you verify something marked `[DOCS]` or `[UNKNOWN]`, upgrade it and bring the evidence: the
HTTP status, the exact error text, the line number, the measured size. A claim without evidence
is how a reference starts lying — and this one is meant to be trusted at 2am.
