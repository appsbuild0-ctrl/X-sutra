# Private Telegram backend setup

Telegram is an internal Premium/VIP media source. Normal users never receive Telegram credentials, source IDs, session strings, or admin setup controls.

## Required server environment

Copy variable **names** from `.env.example` and configure values in the deployment provider. Never place production values in source files.

- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_PHONE`
- `ADMIN_TELEGRAM_USER_ID`, `TELEGRAM_SOURCE_CHANNEL`
- `DATABASE_URL`
- `ADMIN_SETUP_SECRET`, `SESSION_ENCRYPTION_KEY`, `AUTH_JWT_SECRET`

The database user needs permission to create the `xs_*` tables on first use. PostgreSQL TLS is required.

## Owner authorization

The internal endpoint `/api/internal/telegram-auth` accepts **one** of two credentials; every visitor with neither receives 401:

- `x-admin-setup-secret: $ADMIN_SETUP_SECRET` (timing-safe compared) — the trusted **first login** only.
- `authorization: Bearer <owner session token>` — issued by the backend right after a successful Telegram login and reused on every later visit.

It is reachable in two ways:

1. **Owner-only admin UI** — Admin Panel → `Telegram` tab (admin role only). The owner types the setup secret into the console once; the secret is held in component memory for that tab session only and is never written to `localStorage`, `sessionStorage`, or any cached store (`npm run check:telegram-security` asserts this). The console shows configuration/connection status and walks the owner through the OTP / 2FA flow.
2. **Trusted terminal** — same JSON calls with `curl`, passing the header manually.

Do not paste commands or screenshots containing secrets into chat, shell history, or source files.

1. POST `{ "action": "send_otp" }` (optionally `"phone": "+<country-code><number>"`; it must equal `TELEGRAM_PHONE`). API ID and API Hash are never requested by the UI.
2. POST `{ "action": "verify_otp", "code": "..." }`.
3. If returned status is `2fa_required`, POST `{ "action": "verify_2fa", "password": "..." }`.

The MTProto session is AES-256-GCM encrypted with a key derived from `SESSION_ENCRYPTION_KEY` and stored in PostgreSQL. It is never returned by the API. The Telegram user ID must equal `ADMIN_TELEGRAM_USER_ID`; otherwise authorization fails.

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
