# The rest of Catalyst

> **Everything in this file is `[DOCS]`.** None of it was exercised in this project — we used
> Data Store, authentication and AppSail only. The signatures and caveats below come from
> Catalyst's official documentation and the bundled `catalyst-*` skills.
>
> Treat it as a starting point and a vocabulary, not as tested knowledge. Before relying on any
> of it, read the source in [09-sdks-and-sources](09-sdks-and-sources.md) — and if you verify
> something, promote it to `[VERIFIED]` with the evidence.

---

## Functions

Stateless handlers, billed per invocation, auto-scaling. Use them for APIs, webhooks and
scheduled work. Use [AppSail](05-appsail-deploy.md) instead for a long-lived server, WebSockets,
or anything that must hold state between requests.

Seven types, each with its own handler signature:

```js
// Advanced I/O — receives raw req/res, can host an Express app
app.post('/api/action', async (req, res) => {
  const catalystApp = catalyst.initialize(req);
});

// Basic I/O
module.exports = async (context, basicIO) => {
  const catalystApp = catalyst.initialize(context);
  basicIO.write(JSON.stringify({ status: 'ok' }));
  context.close();
};

// Event
module.exports = async (event, context) => {
  const catalystApp = catalyst.initialize(context);   // event.data is the payload
  context.close();
};

// Cron
module.exports = async (cronDetails, context) => {
  const maxMs = context.getMaxExecutionTimeMs();        // "900000" — a STRING
  const left  = context.getRemainingExecutionTimeMs();
  context.close();
};

// Job — MUST use admin scope; no USER token exists in the Job runtime
module.exports = async (jobData, context) => {
  const catalystApp = catalyst.initialize(context, { scope: 'admin' });
  context.closeWithSuccess();
};
```

Also: Integration and Browser Logic.

Notes the docs flag:

- 15-minute execution limit for Cron and Job; `getMaxExecutionTimeMs()` returns a **string**.
- Cron and Job must call `closeWithSuccess()` / `closeWithFailure()` to signal completion.
- `catalyst-config.json` holds per-function configuration.
- **Security Rules** control who may invoke a function: `authentication: optional | required`,
  applied function-wide rather than per method, plus which HTTP methods are enabled. That is
  separate from Data Store table permissions, which control what an authenticated user may do
  with data.
- The function URL needs an `/execute` suffix in some configurations — a documented source of
  404s.
- Duplicate CORS headers are a known failure when the function sets headers the gateway also
  sets.

---

## Cache

In-memory key-value store with TTL, for ephemeral and session data.

```js
const segment = app.cache().segment(segmentId);

await segment.put('key', 'value');            // default 48h TTL
await segment.put('key', 'value', 1);         // TTL in HOURS
const value = await segment.getValue('key');  // the string
const item  = await segment.get('key');       // the full cache item
await segment.update('key', 'newValue');
await segment.delete('key');                  // sets null; does not remove the key
```

Note `delete()` nulls the value rather than removing the key, and TTL is expressed in hours.

---

## Stratus — object storage

Not S3-API-compatible; it has its own SDK surface. Migrate from S3 or GCS with the Stratus
Migration Tool.

```js
const bucket = app.stratus().bucket('your-bucket-name');

const page = await bucket.listPagedObjects({ prefix: 'uploads/', maxKeys: 100 });
for await (const obj of bucket.listIterableObjects({ prefix: 'uploads/' })) { … }
```

**Bucket names are globally unique across all Catalyst projects**, so a plausible name is
probably taken.

Supports signed URLs and multipart upload.

---

## NoSQL

Key-value store with typed items, built through a `NoSQLItem` builder. A partition key is
required.

```js
const table = app.nosql().table('MyTable');
await table.insertItems(…);
await table.fetchItem(…);
await table.updateItems(…);
await table.deleteItems(…);
await table.queryTable(…);
```

Choose [Data Store](03-datastore.md) instead when you need ZCQL, joins, or a fixed relational
schema.

---

## Signals

Event bus for decoupled applications. Publishers (Zoho services, Catalyst, or custom), targets
(webhooks, functions, circuits), event filtering and transformation, batch and scheduled
dispatch, retry policies.

Console-only — no SDK or programmatic API.

---

## Zia and QuickML

OCR, face analytics, text analytics, object detection, barcode reading, content moderation, and
AutoML predictions.

Regional restrictions the docs call out: Identity Scanner is IN-only; AutoML/QuickML is **not**
available in EU, AU, IN, JP, SA or CA. Check availability before designing around it.

---

## SmartBrowz

Browser automation and document generation: headless Chrome/Firefox via
Puppeteer/Playwright/Selenium, Browser Logic functions, PDF and screenshot generation from
HTML/URL/template, and a data-scraping API.

---

## Pricing

Free tier plus pay-as-you-go, billed in GB-seconds for compute. The `catalyst-pricing` skill
carries the current rates and a worked calculation — prices change, so read it there rather
than trusting a number copied into this file.

One limit that shapes development rather than cost: the **Development environment caps at 25
app users**, and Data Store at 5,000 rows per table / 25,000 per project. Production has no such
caps.
