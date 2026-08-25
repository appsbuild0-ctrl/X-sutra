# Private Telegram backend setup

Telegram is an internal Premium/VIP media source. Normal users never receive Telegram credentials, source IDs, session strings, or admin setup controls.

## Required server environment

Copy variable **names** from `.env.example` and configure values in the deployment provider. Never place production values in source files.

- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_PHONE`
- `ADMIN_TELEGRAM_USER_ID`, `TELEGRAM_SOURCE_CHANNEL`
- `DATABASE_URL`
- `ADMIN_SETUP_SECRET`, `SESSION_ENCRYPTION_KEY`, `AUTH_JWT_SECRET`

The database user needs permission to create the `xs_*` tables on first use. PostgreSQL TLS is required.

## Owner authorization (trusted server/CLI only)

The internal endpoint `/api/internal/telegram-auth` is intentionally absent from frontend code. Call it only from a trusted terminal, passing `ADMIN_SETUP_SECRET` in `x-admin-setup-secret`. Do not paste commands containing secrets into chat, screenshots, shell history, or source files.

1. POST `{ "action": "send_otp" }`.
2. POST `{ "action": "verify_otp", "code": "..." }`.
3. If returned status is `2fa_required`, POST `{ "action": "verify_2fa", "password": "..." }`.

The MTProto session is AES-256-GCM encrypted with a key derived from `SESSION_ENCRYPTION_KEY` and stored in PostgreSQL. It is never returned by the API. The Telegram user ID must equal `ADMIN_TELEGRAM_USER_ID`; otherwise authorization fails.

## Premium authorization

`/api/telegram/channels` independently verifies an X-Sutra JWT signed with `AUTH_JWT_SECRET`. Only `premium`, `vip`, or `admin` claims pass. A missing/invalid token receives 401; a normal role receives 403. Production account login must issue this JWT as a Secure, HttpOnly, SameSite=Strict cookie or pass it as a bearer token from a trusted auth layer. Never derive server roles from localStorage.

## Local verification

```bash
npm run check:telegram-security
npm run build
```

Live OTP/channel tests additionally require the server environment and a reachable PostgreSQL database. Netlify configuration/deployment is intentionally not performed by this repository setup.
