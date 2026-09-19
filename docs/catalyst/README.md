# Zoho Catalyst — working reference

Written while taking this app from "Catalyst has never once stored a row" to a deployed
service with real per-user authentication and live Data Store writes. Most of that time went
on things the documentation does not say, or says incorrectly. Those are recorded here with
the evidence that established them.

Read this file, then open the one file you need.

---

## How claims are marked

Every non-obvious statement carries its provenance. This matters: an agent acting on this
reference must be able to tell what was proven from what was merely read.

| Marker | Means |
|---|---|
| **`[VERIFIED]`** | Observed against a live Catalyst project, with the evidence quoted — an HTTP status, the exact error text, a line number in Catalyst's own file, a measured size. |
| **`[DOCS]`** | From Catalyst's official documentation or the bundled skills. Not exercised here. Believe it, but do not present it as tested. |
| **`[DOCS-WRONG]`** | The documentation says one thing and we observed another. Both are stated. These are the most valuable entries in this set. |
| **`[UNKNOWN]`** | Genuinely not established. Named so nobody fills the gap with a guess. |

If something here is unmarked, it is ordinary mechanics (a file path, a command name) rather
than a claim about Catalyst's behaviour.

---

## Change these first

Every command in these files is written against **this** project so it can be pasted and run.
That also means a stale identifier will quietly read and write **someone else's** project. The
Data Store API does not care that you meant a different one.

| What | Value here | Where to find yours |
|---|---|---|
| Project ID | `69251000000061001` | `.catalystrc` after `catalyst init`, or the console URL |
| Org ID | `60084215173` | `.catalystrc` → `projects[0].env[0].id`, or the console |
| Data centre | `in` | `active_dc` in the CLI config — see [01-credentials](01-credentials.md) |
| API host | `https://api.catalyst.zoho.in` | derived from the data centre |
| ZAID | `50045863073` | `/__catalyst/sdk/init.js`, or Console → Authentication → App Settings |
| AppSail service | `hitlist-api` | `catalyst.json`, or `pnpm run appsail:url` |
| Tables | `KaizenTasks`, `KaizenLists`, `KaizenNotes` | [03-datastore](03-datastore.md) |

```bash
# Confirm which project you are actually pointed at before doing anything destructive.
cat .catalystrc | python3 -m json.tool | head -20
```

---

## Five-minute start

```bash
npm install -g zcatalyst-cli
catalyst login                                                    # interactive; opens a browser
catalyst init --org 60084215173 -p 69251000000061001 -ni --dc in  # writes .catalystrc
```

`catalyst login` cannot be scripted. Everything after it can.

Prove the connection with a real query rather than trusting the CLI's success message — see
[01-credentials](01-credentials.md) for how to get a token, and
[03-datastore](03-datastore.md#zcql) for the query.

```bash
pnpm catalyst:setup          # create the tables and columns
pnpm run appsail:url         # where the deployed app lives
curl -s https://hitlist-api-50045863073.development.catalystappsail.in/api/health
# {"ok":true,"backend":"catalyst","catalystMode":"gateway",...}
```

`"backend":"catalyst"` is the single most useful signal in this whole system. If it says
`json-file`, the app is running but storing nothing in Catalyst — see
[08-troubleshooting](08-troubleshooting.md).

---

## Which file do I want

| I want to… | File |
|---|---|
| Log in, get a token, understand data centres | [01-credentials.md](01-credentials.md) |
| Initialise the Node SDK, choose a scope | [02-node-sdk.md](02-node-sdk.md) |
| Create tables, read and write rows, run ZCQL | [03-datastore.md](03-datastore.md) |
| Add user login with Catalyst's own form | [04-auth-embedded.md](04-auth-embedded.md) |
| Deploy a server | [05-appsail-deploy.md](05-appsail-deploy.md) |
| Host a frontend | [06-slate.md](06-slate.md) |
| Run scheduled work, send email or push | [12-scheduling-and-delivery.md](12-scheduling-and-delivery.md) |
| Connect a user's Zoho Calendar | [13-zoho-calendar.md](13-zoho-calendar.md) |
| Use Functions, Cache, Stratus, NoSQL, Signals, Zia | [07-other-services.md](07-other-services.md) |
| Look up an SDK method, or find the authoritative source | [09-sdks-and-sources.md](09-sdks-and-sources.md) |
| Copy a working script | [10-recipes.md](10-recipes.md) |
| Know what is *not* established | [11-unknowns.md](11-unknowns.md) |

---

## I am seeing this error

The full table is in [08-troubleshooting.md](08-troubleshooting.md). These are the ones most
likely to cost an afternoon, because each says something misleading about its own cause.

| Error text | It actually means | Where |
|---|---|---|
| `unable to find the type of initialisation` | `initialize()` was given something that is not a request | [02](02-node-sdk.md#initialisation) |
| `404 INVALID_ID` / `No such Table with the given id exists` | The id was rounded by `JSON.parse`; the table is fine | [03](03-datastore.md#ids-are-bigint) |
| `401 Authentication failed` on a valid token | Wrong data centre | [01](01-credentials.md#data-centres) |
| `getCurrentUser()` returns null for a signed-in user | Initialised with admin scope instead of user scope | [02](02-node-sdk.md#scope) |
| `server://net-issue` code 700 | Any non-2xx, including an ordinary signed-out 401 | [04](04-auth-embedded.md#error-code-700) |
| `Execution failed. Please check the startup command or port.` | Five different causes, none of them the command | [05](05-appsail-deploy.md#the-503) |
| `INVALID_INPUT` on a row insert | The `{data: […]}` wrapper the docs show; use a bare array | [03](03-datastore.md#rest-payload-shapes) |
| `INVALID_OPERATION` on a column name | Reserved keyword — `Priority` is one | [03](03-datastore.md#reserved-column-names) |
| `environment_variables must not contain reserved keywords` | `CATALYST_` and `NODE_` prefixes are reserved | [05](05-appsail-deploy.md#environment-variables) |
| The login form shows every step at once | `css_url` replaced Catalyst's stylesheet | [04](04-auth-embedded.md#styling-the-form) |
| `No such from_email with the given id exists` | The sender address is not registered — a console step | [12](12-scheduling-and-delivery.md#email) |
| `cron_name must contain only alphanumeric and underscore` | Cron and job names reject hyphens | [12](12-scheduling-and-delivery.md#two-validation-rules-that-are-not-in-any-doc) |
| Server logs `backend: json-file` inside Catalyst | The startup probe cannot authenticate under the gateway | [02](02-node-sdk.md#initialisation) |

---

## The shape of the thing

Catalyst is several products under one console. What matters architecturally:

- **AppSail** runs a persistent server process. A normal Express app.
- **Slate** hosts static files. No server — `/api/*` returns your `index.html`. `[VERIFIED]`
- **Functions** are stateless handlers, billed per invocation. `[DOCS]`
- **Data Store** is a relational database reached by SDK, REST, or ZCQL (a SQL-like language).
- **Authentication** issues sessions to *app users*, who are distinct from the console
  collaborators who own the project. This distinction causes more confusion than anything else
  in the platform — see [04-auth-embedded](04-auth-embedded.md).

The single most important structural fact: **credentials reach your code in completely
different ways depending on where it runs.** Inside Catalyst they arrive as per-request
headers; outside, you supply them yourself. Code that assumes one will fail silently under the
other. That is [02-node-sdk](02-node-sdk.md), and it is worth reading before writing anything.
