# Zoho Calendar integration

HitList keeps its existing Catalyst account login. A signed-in person can then
connect their own Zoho Calendar account, which gives HitList read-only access to
that person's calendars and events. The server fetches the events when the
Calendar view opens or is refreshed; it does not create, move, or delete Zoho
events.

## Register the OAuth client

In the Zoho API Console, create a **Server-based Application**. Its redirect
URI must exactly match the server callback URL:

```text
https://your-hitlist-domain/api/zoho-calendar/callback
```

For local development, register this separately:

```text
http://localhost:3001/api/zoho-calendar/callback
```

Request only these read scopes:

```text
ZohoCalendar.calendar.READ,ZohoCalendar.event.READ
```

Create equivalent redirect configuration for each Catalyst environment. Do not
reuse a Development client configuration in Production without updating its
redirect URI and confirming the relevant Zoho data centre.

## Configure the server

Set these server-only variables in `.env.local` for local development and in
the AppSail runtime configuration for deployment:

```text
ZOHO_CALENDAR_CLIENT_ID=...
ZOHO_CALENDAR_CLIENT_SECRET=...
ZOHO_CALENDAR_REDIRECT_URI=https://your-hitlist-domain/api/zoho-calendar/callback
ZOHO_CALENDAR_ENCRYPTION_KEY=...
```

Generate the encryption key with `openssl rand -base64 32`. It encrypts each
user's refresh token before persistence. Treat it like a production secret:
rotating it without a migration invalidates all stored connections, so users
must reconnect.

The default Zoho domains target the India data centre. Configure
`ZOHO_CALENDAR_ACCOUNTS_DOMAIN` and `ZOHO_CALENDAR_API_DOMAIN` for another
registered Zoho data centre. Verify multi-DC behavior before claiming support
for accounts outside the client registration data centre.

For linked AppSail services, redeploying applies the environment configuration
declared for the service. Keep every required `ZOHO_` variable in that
deployment configuration; do not rely on console-only values persisting across
redeploys.

## Security and behavior

- The browser never receives the client secret, authorization code, refresh
  token, access token, or encrypted credential.
- OAuth state is encrypted, bound to the currently authenticated Catalyst owner,
  and expires after ten minutes.
- Connection rows are filtered by `OwnerId` on every read, update, and delete.
- Zoho's event-list range is limited to 31 days. HitList requests sequential
  bounded ranges from one month before today through twelve months ahead.
- Disconnect removes HitList's stored credential. Revoke the connected app in
  Zoho Accounts as well when immediate provider-side revocation is required.

## MCP boundary

The Zoho Calendar MCP server configured in VS Code authorizes Copilot tools for
one configured Zoho account. It is not deployed with HitList and is never used
to serve application users. Every HitList user must complete their own OAuth
consent flow.