# Setting up the Cliq bot (do this once)

Menu names in Cliq may differ slightly; if a screen does not match, take a screenshot and ask.

## 1. Each person: sign in to Cliq once
Everyone who should get alerts needs a Cliq account in the organisation and must have **signed in to Cliq at least once**. They
should also open the HitList bot's chat and press **Subscribe** (or say hi), so a message from the bot has a chat to arrive in.

## 2. Create the bot (the Cliq admin or owner)
1. In Cliq open **Bots & Tools**, **Bots**, **Create Bot**.
2. Name `HitList`; unique name for example `hitlistbot`; a short description.
3. Make it available to **everyone in the organisation** (otherwise it cannot message people who have not subscribed).
4. No handler scripts are needed for phase 1.

## 3. Make a webhook token
**Bots & Tools, Webhook Tokens, Generate New Token** (Cliq asks for two-factor sign-in). A person can have at most 5. The token is a
password: never put it in the repository, a chat or the app.

## 4. Prove it works, before any code
Run this in your own terminal with your own values (India data centre shown; use `cliq.zoho.com` or another if your Cliq is elsewhere):

```
curl -s -X POST "https://cliq.zoho.in/api/v2/bots/hitlistbot/message?zapikey=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userids":"you@yourcompany.com","text":"Test from HitList"}'
```

A direct message from the HitList bot should appear in your Cliq. If not, note the response text (an error code or message); the
usual causes are a wrong bot unique name, the bot not visible to you, a wrong region, or a bad token.

## 5. Give the Catalyst Function its settings
The Function reads `CLIQ_BOT`, `CLIQ_TOKEN`, `CLIQ_ALLOWED_DOMAINS` (your company email domain) and `CLIQ_DC` (default `in`) from its
environment. The token must never be committed, so put them in a local file that git ignores, `functions/backup/.env.cliq`:

```
CLIQ_BOT=hitlistbot
CLIQ_TOKEN=<the webhook token>
CLIQ_ALLOWED_DOMAINS=yourcompany.com
CLIQ_DC=in
```

and deploy with `sh scripts/deploy-backup-function.sh` (it writes the values into the function's config only for the deploy, then
restores the file, so nothing secret reaches git). Note: the bot's unique name is **lowercase** (`hitlistbot`); `HitListBot` gives
"request URL invalid". If the token is ever pasted into a chat or leaked, generate a new one in Cliq and redeploy.

## What each person does in HitList (once phase D exists)
Account menu, **Cliq alerts**: switch on, type your Cliq email, press **Send test message**. Alerts only go out while HitList is open.
