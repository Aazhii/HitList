# Working scripts

Every script here was written for this project and run against the live Catalyst project. Each
exists because something was harder than it should have been; the note says what.

Paths are relative to the repo root.

---

## Schema

### `pnpm catalyst:setup` — [`scripts/catalyst-setup.ts`](../../scripts/catalyst-setup.ts)

Creates the tables and columns in [`server/catalyst/schema.ts`](../../server/catalyst/schema.ts).

```bash
pnpm catalyst:setup --dry-run    # report what is missing, change nothing
pnpm catalyst:setup              # create it
```

Takes credentials from `.env.local` or, failing that, the CLI's login — so after
`catalyst login` it needs no configuration.

Worth reading for four things it has to work around, all covered in
[03-datastore](03-datastore.md): BigInt ids surviving `JSON.parse`, resolving tables by name
because the create response's `table_id` is unreliable, retrying 5xx but never 4xx, and naming
reserved-keyword rejections clearly instead of failing opaquely.

---

## Data maintenance

### `scripts/migrate-owner.mjs` — reassign rows between owners

```bash
node --import tsx scripts/migrate-owner.mjs --from hitlist-shared --to 69251000000064013
node --import tsx scripts/migrate-owner.mjs --from hitlist-shared --to 69251000000064013 --apply
```

Dry run by default. Written when the app moved from a single shared owner to real per-user
identities: rows written under the old key would otherwise have become invisible the moment
scoping turned on.

Also the reference for the update payload shape — `PATCH /table/{name}/row` with a **bare
array**, each entry carrying its own `ROWID`.

### `scripts/seed-lists.mjs` — create the default lists for a user

```bash
node --import tsx scripts/seed-lists.mjs --owner 69251000000064013
node --import tsx scripts/seed-lists.mjs --owner 69251000000064013 --apply
```

Written after a subtler failure: tasks created while the app still ran on `localStorage` carried
seed list ids that only ever existed in the browser. Once the server became the source of truth,
every task pointed at a list Catalyst had never heard of — so the sidebar was empty and the UI
filtered all of them out. Auth was fine; the data was dangling.

**Worth generalising:** after any migration from local storage, check that foreign keys resolve.
Nothing errors when they do not.

---

## Deployment

### `pnpm run appsail:url` — [`scripts/appsail-url.mjs`](../../scripts/appsail-url.mjs)

```
HitList (69251000000061001) — in

  hitlist-api  [node24]  running
  https://hitlist-api-50045863073.development.catalystappsail.in
```

The URL is printed once on a successful deploy and otherwise only lives in the console, which is
easy to lose among similar-looking Slate hostnames. Also shows the running state — useful when
something returns 503, since a stopped service and a crashed one look identical from a browser.

### Docker image build

AppSail now deploys the Docker image built by [`Dockerfile`](../../Dockerfile).
Build a Linux/amd64 OCI image and deploy it with `catalyst deploy appsail
--source docker://…`; see [05-appsail-deploy](05-appsail-deploy.md).

### `scripts/build-login-css.sh` — the login stylesheet

```bash
./scripts/build-login-css.sh      # → public/catalyst-login.css
```

Downloads Catalyst's published base sheet and appends the theme from `styles/`. Never hand-edit
above the theme block — see [04-auth-embedded](04-auth-embedded.md#styling-the-form) for why a
theme-only sheet destroys the form.

### `pnpm run check:lockfiles` — [`scripts/check-lockfiles.mjs`](../../scripts/check-lockfiles.mjs)

Fails if `pnpm-lock.yaml` or `package-lock.json` disagrees with `package.json`. Only relevant if
you carry both, as this project must — see
[06-slate](06-slate.md#the-npm-10-build-failure). The drift is dangerous: add a dependency with
pnpm alone and the deploy silently ships the old tree.

---

## Reference implementations

Not scripts, but the files worth reading before writing your own:

| File | Shows |
|---|---|
| [`server/catalyst/init.ts`](../../server/catalyst/init.ts) | All three init modes, scope selection, app caching and rebuild-on-expiry |
| [`server/catalyst/region.ts`](../../server/catalyst/region.ts) | Setting the API host **before** the SDK loads |
| [`server/catalyst/dc.ts`](../../server/catalyst/dc.ts) | The data-centre host map |
| [`server/catalyst/schema.ts`](../../server/catalyst/schema.ts) | One schema definition, with real column types |
| [`server/catalyst/cliCredentials.ts`](../../server/catalyst/cliCredentials.ts) | Borrowing the CLI's login, with memoisation |
| [`server/catalyst/baasProxy.ts`](../../server/catalyst/baasProxy.ts) | The `/baas/*` proxy, and the header stripping that keeps it safe |
| [`src/lib/catalystAuth.ts`](../../src/lib/catalystAuth.ts) | Web SDK auth wrapper, readiness polling, error translation |
| [`styles/catalyst-login.append.css`](../../styles/catalyst-login.append.css) | The theme layer, with each Catalyst quirk commented where it is worked around |

---

## A diagnostic worth keeping

The nine-line probe that separates "the platform is broken" from "my app is broken". Deploy it
as the whole app when AppSail returns 503:

```js
import http from 'node:http';
const PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || 9000;
console.log('[probe] node', process.version, 'port', PORT);
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ probe: true, node: process.version, port: String(PORT) }));
}).listen(PORT, '0.0.0.0', () => console.log('[probe] listening'));
```

It has **no dependencies**, which is the point — if it runs and your app does not, missing
`node_modules` is the first thing to check.

Remove any `predeploy` hook before deploying it, or the hook will regenerate the bundle and
overwrite the probe. That cost two deploy cycles here.
