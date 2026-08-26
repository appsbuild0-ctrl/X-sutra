# Private Telegram backend setup

Telegram is an internal Premium/VIP media source. Normal users never receive Telegram credentials, source IDs, session strings, or admin setup controls.

## Required server environment

Copy variable **names** from `.env.example` and configure values in the deployment provider. Never place production values in source files.

- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_PHONE`
- `ADMIN_TELEGRAM_USER_ID`, `TELEGRAM_SOURCE_CHANNEL`
- `DATABASE_URL`
- `SESSION_ENCRYPTION_KEY`, `AUTH_JWT_SECRET`

`ADMIN_SETUP_SECRET` is optional and no longer used by the UI (simple OTP login). Keep it only for the trusted CLI.

The database user needs permission to create the `xs_*` tables on first use. PostgreSQL TLS is required.

## Owner login (simple — no setup secret in the UI)

Admin Panel → `Telegram` tab shows only a login flow, never a key field:

1. Tap **Send login code** → `POST { "action": "send_otp" }`. The code goes only to the phone configured as `TELEGRAM_PHONE`; API ID/Hash are never asked.
2. Enter it → `POST { "action": "verify_otp", "code": "..." }`.
3. If the account has 2FA → `POST { "action": "verify_2fa", "password": "..." }` once.

The endpoint is unauthenticated by design but safe because: only `TELEGRAM_PHONE` receives codes, code requests are rate-limited per caller (1/minute, 5/hour, stored in `xs_rate`), and authorization succeeds only when the Telegram user ID equals `ADMIN_TELEGRAM_USER_ID`.

The MTProto session is AES-256-GCM encrypted with a key derived from `SESSION_ENCRYPTION_KEY` and stored in PostgreSQL. It is never returned by the API.

## One-time login (no repeated OTP)

Telegram is authorized **once**; nothing in the flow asks for a second login on the same device or after a redeploy:

- The encrypted MTProto session lives in PostgreSQL (`xs_telegram_auth`), so it survives cold starts and redeploys. Every successful use writes the refreshed session string back, which is what keeps Telegram from rotating the auth key out from under the stored copy.
- `send_otp` re-checks the stored session first. If it still authorizes, the response is `{ "status": "already_authorized" }` and **no new code is sent**.
- The successful `verify_otp` / `verify_2fa` response (and the first bootstrap `GET`) includes a signed owner session token: `{ "ownerToken": "...", "expiresAt": "...", "expiresInDays": 180 }`. The admin console stores only that token on the device (`src/lib/telegramOwner.ts`) and reopens by itself from then on. `OWNER_SESSION_DAYS` overrides the lifetime; rotating `AUTH_JWT_SECRET` revokes every issued token immediately.
- Status reads are cached per container for 5 minutes and a transient MTProto/network failure returns the last known good state instead of reporting the source as logged out.
- “Forget this device” in the console clears the local owner token, which brings back the one-time unlock screen.


## Premium authorization

`/api/telegram/channels` independently verifies an X-Sutra JWT signed with `AUTH_JWT_SECRET`. Only `premium`, `vip`, or `admin` claims pass. A missing/invalid token receives 401; a normal role receives 403. Production account login must issue this JWT as a Secure, HttpOnly, SameSite=Strict cookie or pass it as a bearer token from a trusted auth layer. Never derive server roles from localStorage.

## Local verification

```bash
npm run check:telegram-security
npm run build
```

Live OTP/channel tests additionally require the server environment and a reachable PostgreSQL database. Netlify configuration/deployment is intentionally not performed by this repository setup.
