# Private Telegram backend setup

> **Two separate Telegram features live in this repo — don't mix them up.**
>
> 1. **User login** ("Login with Telegram", `README.md` → *Login with Telegram + admin uploads*):
>    uses only `TELEGRAM_BOT_TOKEN` + `DATABASE_URL` + `AUTH_JWT_SECRET`, via the official Telegram
>    Login Widget and `/api/auth/telegram`. No `API_ID`, `API_HASH`, phone number or MTProto session.
> 2. **This document — the owner-only private source**: an MTProto session that imports the owner's
>    own Telegram channels into Premium. It needs `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`,
>    `TELEGRAM_PHONE` and `ADMIN_TELEGRAM_USER_ID`, and is optional.

Telegram is an internal Premium/VIP media source. Normal users never receive Telegram credentials, source IDs, session strings, or admin setup controls.

## Required server environment

Copy variable **names** from `.env.example` and configure values in the deployment provider. Never place production values in source files.

- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_PHONE`
- `ADMIN_TELEGRAM_USER_ID`, `TELEGRAM_SOURCE_CHANNEL`
- `DATABASE_URL`
- `SESSION_ENCRYPTION_KEY`, `AUTH_JWT_SECRET`

`ADMIN_SETUP_SECRET` is optional and no longer used by the UI (simple OTP login). Keep it only for the trusted CLI.

The database user needs permission to create the `xs_*` tables on first use. PostgreSQL TLS is required.

## Owner login (one field: the OTP)

Admin Panel → `Telegram` tab shows only a login flow, never a key field and never a phone field:

1. Tap **Send login code** → `POST { "action": "send_otp" }` (no phone in the body — the server ignores
   any `phone` value it is sent). The code goes only to `TELEGRAM_PHONE`; API ID/Hash are never asked.
   The response carries `phoneHint`, a masked copy of that number (`+91••••••••10`) so the owner knows
   where to look. The full number is never returned.
2. Enter the code → `POST { "action": "verify_otp", "code": "..." }`. This is the only thing the owner types.
3. If the account has 2FA → `POST { "action": "verify_2fa", "password": "..." }` once.

On success the console needs no further taps: the signed `ownerToken` in the response is stored on the
device (`src/lib/telegramOwner.ts`), the owner's channels are imported with that token right away, and
the card calls `onConnected` so the hosting panel closes itself (Admin Panel → Premium, where the
imported sources are listed).

The endpoint is unauthenticated by design but safe because: only `TELEGRAM_PHONE` receives codes, code
requests are rate-limited per caller (1/minute, 5/hour, stored in `xs_rate`), and authorization succeeds
only when the Telegram user ID equals `ADMIN_TELEGRAM_USER_ID`.

### Errors are reported exactly

A failed step returns the reason the backend actually hit, so the owner can act on it:

| Situation | Response |
| --- | --- |
| Wrong code | `400 {"error":"Telegram authorization failed: PHONE_CODE_INVALID — the code was rejected — retype it from your Telegram app.","telegramError":"PHONE_CODE_INVALID"}` |
| Expired code | `400 … "PHONE_CODE_EXPIRED — the code expired — request a new one."` |
| Wrong Telegram account | `403 {"error":"Authorized Telegram identity is not the configured owner (Telegram user 999 ≠ ADMIN_TELEGRAM_USER_ID 4242)."}` |
| Second code within a minute | `429 {"error":"A code was just sent. Wait a minute before requesting another."}` |
| Missing server variable | `503 {"error":"Server configuration incomplete: TELEGRAM_PHONE"}` / `503 … TELEGRAM_PHONE is not set on the server …` |
| Anything else | `500 {"error":"Backend: <real message>"}` |

The old catch-all `"Telegram authorization failed."` / `"Backend operation failed."` strings are gone
from this path; unknown Telegram error codes are still shown verbatim. The console renders `error`
as-is, so the same text appears on screen.

The MTProto session is AES-256-GCM encrypted with a key derived from `SESSION_ENCRYPTION_KEY` and stored
in PostgreSQL. It is never returned by the API, and the OTP hash column is cleared as soon as a login
finishes.

## One-time login (no repeated OTP)

Telegram is authorized **once**; nothing in the flow asks for a second login on the same device or after a redeploy:

- The encrypted MTProto session lives in PostgreSQL (`xs_telegram_auth`), so it survives cold starts and redeploys. Every successful use writes the refreshed session string back, which is what keeps Telegram from rotating the auth key out from under the stored copy.
- `send_otp` re-checks the stored session first. If it still authorizes, the response is `{ "status": "already_authorized" }` and **no new code is sent**.
- The successful `verify_otp` / `verify_2fa` response (and the first bootstrap `GET`) includes a signed owner session token: `{ "ownerToken": "...", "expiresAt": "...", "expiresInDays": 180 }`. The admin console stores only that token on the device (`src/lib/telegramOwner.ts`) and reopens by itself from then on. `OWNER_SESSION_DAYS` overrides the lifetime; rotating `AUTH_JWT_SECRET` revokes every issued token immediately.
- Status reads are cached per container for 5 minutes and a transient MTProto/network failure returns the last known good state instead of reporting the source as logged out.
- “Forget this device” in the console clears the local owner token, which brings back the one-time unlock screen.


## Importing channels (`sync_channels`)

`/api/telegram/channels` only **reads** `xs_channels`; nothing else in the backend writes it, so the Premium
“🔐 Telegram sources” list stays empty until the owner imports their channels once:

- The console does this **automatically right after a successful OTP/2FA login**, using the owner token
  that login just returned — no extra tap.
- Manual retry / re-import: Admin Panel → `Telegram` tab → **Import Telegram channels** →
  `POST { "action": "sync_channels" }` with the device's owner bearer token.
- The handler is owner-gated (`requireOwner`): no token → 401, forged token → 401.
- Server-side it reuses the stored MTProto session, reads the owner's dialog list, keeps only
  `Api.Channel` entities (broadcast channels and supergroups — private chats and legacy basic groups are
  skipped), dedupes, caps at 60 rows, and upserts them into `xs_channels`.
- `published` and `access_role` are never overwritten by a re-sync, so hiding a source or opening it to VIP
  only survives repeated imports.
- Response: `{ "ok": true, "status": "synced", "scanned": <dialogs>, "channels": <found>, "saved": <rows> }`.
- Requires a completed owner login first (`status: 'authorized'` in `xs_telegram_auth`); otherwise 409.
- Media (`xs_media`) is not imported yet, so `media_count` stays 0 until a media importer exists.

Verified without Telegram or PostgreSQL by `npm run check:channel-sync`, which runs the real
`pickChannelRows` / `syncChannels` / handler code against fake dialogs and a fake database.

## Premium authorization

`/api/telegram/channels` independently verifies an X-Sutra JWT signed with `AUTH_JWT_SECRET`. Only `premium`, `vip`, or `admin` claims pass. A missing/invalid token receives 401; a normal role receives 403. Production account login must issue this JWT as a Secure, HttpOnly, SameSite=Strict cookie or pass it as a bearer token from a trusted auth layer. Never derive server roles from localStorage.

## Local verification

```bash
npm run check:telegram          # security + login flow + channel import
npm run check:telegram-login    # OTP login end to end, incl. the Vercel api/ entries
npm run build
```

`check:telegram-login` drives the real `telegram-admin` handler and the real Vercel entries
(`api/internal/telegram-auth.mjs`, `api/telegram/channels.mjs`, `api/[...path].mjs`) with `teleproto` and
PostgreSQL swapped for the in-memory fixtures in `scripts/fixtures/` — no Telegram account and no
database needed. It asserts that the phone only ever comes from `TELEGRAM_PHONE`, that a correct OTP
returns the owner token, that the token imports the channels, and that failures carry the exact
Telegram error.

Live OTP/channel tests additionally require the server environment and a reachable PostgreSQL database.
Netlify configuration/deployment is intentionally not performed by this repository setup.
