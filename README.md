# X-sutra

**X-sutra** is a dark, mobile-first public-media browser built as a standalone React + Capacitor application. It is branded and structured independently; the shared external project is used only as a product/feature reference.

## What works

- Android-ready React + Capacitor project
- Hash-routed pages: **Home**, **Discover**, **Search**, **Creator**, **Tag**, **Niche**, **Library**, **Collection**, **Downloads**, **You**, **Login**, and **Settings**
- Real public RedGifs V2 feeds: Trending, Latest, search, tag results, creator clips, creator profiles, niche clips, live suggestions, categories, and related niches
- Real public thumbnails and browser/native video playback in a full-screen player
- Public watch-link / clip-ID resolver and device/browser download flow using the current media URL returned by the API
- Browser response validation rejects HTML/error documents instead of renaming them as video files; CORS-only fallbacks are reported as opened, not completed
- Local-only likes, saved clips, follows, collections, download history, autoplay/mute preferences, and blocked-tag filtering
- Optional device-local login page (`#/login`) with username/password fields, sign-in / create-account modes, a show/hide password eye toggle, and a built-in admin account (`admin` / `admin123`) that opens the admin panel
- Premium section with fixed tabs (Home, Reels, Discover, Categories, Announcements), admin-managed channels/albums, and bulk URL import
- Local accounts store only a SHA-256 password hash on the device; the raw password is never persisted or transmitted
- No demo/fake feed data and no external account password/token capture

- **Login with Telegram** (`#/login`): the official Telegram Login Widget, verified server-side, with accounts stored in PostgreSQL and admin-gated uploads

## Login with Telegram + admin uploads

Users sign in with Telegram (no password, no OTP, no MTProto session, no `API_ID`/`API_HASH` —
this flow needs only a **bot**). The Telegram user id is the account identifier, the backend issues a
signed X-Sutra JWT, and admins upload content straight into the existing Neon database.

Everything runs on same-origin `/api/...` routes in this deployment — **there is no `BACKEND_URL`**:

| Route | Purpose |
| --- | --- |
| `GET /api/auth/telegram` | public widget config (bot `@username` only, never the token) |
| `POST /api/auth/telegram` | `login` / `session` / `logout`, plus admin-only `listAdmins`, `addAdmin`, `removeAdmin`, `listUsers`, `setUserRole`, `setUserStatus` |
| `GET /api/uploads` | published upload metadata (role-filtered) |
| `POST /api/uploads` | admin-only `start` / `chunk` / `finish` / `update` / `delete` |
| `GET /api/uploads/<id>` | the file itself, with real HTTP Range support so the existing player seeks |

Uploaded files are stored as 3 MB chunk rows in PostgreSQL (a Vercel function body is capped at
~4.5 MB) and reassembled on read. Videos/images appear automatically in Premium under
**📤 X-Sutra uploads** and play through the existing player and download flow.

### 1. BotFather — what to do

1. Open Telegram and message **@BotFather** → `/newbot`.
2. Choose a display name (e.g. `X-Sutra`) and a username ending in `bot` (e.g. `x_sutra_login_bot`).
3. Copy the **HTTP API token** it replies with — that value is `TELEGRAM_BOT_TOKEN`.
4. Set the domain the login button will run on: `/setdomain` → pick your bot → enter your production
   domain **without** `https://` and without a path (e.g. `x-sutra.vercel.app`).
5. Nothing else is needed. No `API_ID`/`API_HASH`, no phone number, no session string.

### 2. Vercel environment variables

Required for Telegram login + uploads:

| Variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the token from @BotFather (server-side only) |
| `DATABASE_URL` | your existing Neon PostgreSQL connection string |
| `AUTH_JWT_SECRET` | a long random string — signs the X-Sutra session JWT |
| `TELEGRAM_ADMIN_IDS` | your Telegram user id(s), comma-separated (first-run bootstrap) |

Optional: `USER_SESSION_DAYS` (default 30), `TELEGRAM_AUTH_MAX_AGE` (default 3600),
`MAX_UPLOAD_MB` (default 200). The `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_PHONE` /
`ADMIN_TELEGRAM_USER_ID` / `SESSION_ENCRYPTION_KEY` variables belong to the separate owner-only
**Source** tab (private Telegram channel import) and are not needed for user login.

### 3. Telegram domain configuration

The widget only renders on the domain registered with `/setdomain`, and only over HTTPS.

- Production: `/setdomain` → `x-sutra.vercel.app` (your real domain).
- Every additional domain you use (a second Vercel project, a custom domain) needs its own bot or a
  `/setdomain` update — Telegram allows one domain per bot.
- Local development: Telegram does not accept `localhost`, so use a tunnel with a real domain
  (`cloudflared tunnel --url http://localhost:5173`) and register that domain, or test the API
  directly with `npm run check:telegram-widget`.

### 4. Where admin Telegram IDs go

- **First admin (recommended):** set `TELEGRAM_ADMIN_IDS` in Vercel (find your id by messaging
  **@userinfobot**).
- **Or zero-config bootstrap:** if there is *no* `TELEGRAM_ADMIN_IDS` and the admin table is empty,
  the **first** Telegram account to log in becomes the admin — the id is written to the database,
  never to the code, and the door shuts once one admin exists.
- **After that:** Admin Panel → **Accounts** tab → *Admin Telegram IDs* → add/remove. These live in
  the `xs_admin_telegram_ids` table; the same tab lists every Telegram account with role and
  enable/disable controls. If you open the tab without a Telegram session, it shows a single
  **Connect with Telegram** button instead of an error.
- No admin secret or token exists in the frontend bundle. The server re-checks the role against the
  database on every upload call, so hiding the UI is never the only defence.

### 5. Testing after deployment

1. Open the site → **Login** → the Telegram button appears (if it does not, the message under it says
   why — usually a missing `TELEGRAM_BOT_TOKEN` or an unregistered domain).
2. Tap **Login with Telegram** → Telegram asks to confirm → you land on **You** (admins land on the
   admin panel).
3. Check the session: `curl https://<your-domain>/api/auth/telegram` returns
   `{"enabled":true,"botUsername":"…","botName":"…"}` and **never** the token.
4. As an admin: Admin Panel → **Uploads** → pick a file, set a title/category, upload → it appears in
   Premium under **📤 X-Sutra uploads** and plays in the existing player.
5. Negative checks: sign in with a non-admin Telegram account → the Uploads/Accounts tabs are absent
   and `POST /api/uploads` returns `403 Only an admin Telegram account can do this.`
6. Logout from **You** → the session is invalidated server-side, not just cleared locally.

Local verification (no Telegram account or database needed):

```bash
npm run check:telegram-widget   # login signature, JWT, admin gate, chunked upload, Range reads
npm run check:telegram          # security + OTP source login + widget login + channel import
npm run build
```

## How live API data works

Browser requests go through the included Netlify Function at `netlify/functions/redgifs.mjs`:

1. The function obtains a fresh read-only public temporary token server-side.
2. It requests only allowlisted public V2/V1 read endpoints.
3. The browser receives real JSON data through same-origin `/api/redgifs`.

This prevents browser CORS problems and keeps external account credentials out of X-sutra. The function requests the API with a stable app User-Agent (`RedGifs-Downloader/4.0`), which returns clean non-watermarked media URLs; the Drop ZIP bundles the same function instead of a header-forwarding rewrite. Vite development uses an equivalent local proxy for `/api/redgifs`. The Capacitor Android build uses Capacitor's native HTTP transport for the same temporary anonymous-token flow, because a packaged WebView has no deployed same-origin function. No private API key is bundled in either path.

## Local development

```bash
npm install
npm run dev
```

The Vite server listens on `0.0.0.0:5173`.

## Direct Netlify Drop ZIP

`X-sutra-netlify-drop.zip` is a static package ready to drag directly onto [Netlify Drop](https://app.netlify.com/drop). Do **not** unzip it. It contains the full production assets and an `_redirects` rule that uses Netlify's same-origin 200 rewrite proxy for `/api/redgifs/*`, so the live public V2 calls avoid browser CORS restrictions. No mock feed is embedded.

`X-sutra-standalone/` contains the same current UI as a single inlined `index.html` plus its Netlify `_redirects` rule. Regenerate both tracked delivery artifacts from the current `src/` implementation with:

```bash
npm run build:artifacts
```

## Live deployment (Vercel)

Production runs on Vercel and is what the repository homepage points at:

```text
https://x-sutra.vercel.app
```

Vercel builds `main` for production and every pull request for preview (preview URLs are behind Vercel Authentication, so open them while logged in to the Vercel account). The backend is shared with Netlify: `api/[...path].mjs` routes `/api/*` to the handlers in `netlify/functions/`, with dedicated filesystem functions for the nested `/api/telegram/channels` and `/api/internal/telegram-auth` paths. Frontend requests use same-origin relative `/api/...` paths, so there is no `BACKEND_URL` setting and no separate backend deployment to configure. Configure the variables from `.env.example` in the Vercel project — without `DATABASE_URL` the one-time Telegram login has nowhere to live and the owner console reports the missing name.

A second Vercel project (`x-sutra-main-2`) builds the same branch but has no server variables configured, so its `/api/*` calls fail; use the main domain above.

## Git-connected Netlify deployment

The repository includes `netlify.toml` with the required settings:

```text
Build command:       npm run build
Publish directory:   dist
Functions directory: netlify/functions
Node version:         22
```

When connecting the repository in Netlify, deploy the protected production branch:

```text
main
```

Netlify builds the app and deploys the public API function together. A plain static `index.html` opened via `file://` cannot call the same-origin function, so use the Netlify deployment for live data/playback.

## Production build

```bash
npm run build
```

## Android sync

```bash
npm run cap:sync
npm run android:open
```

Open `android/` in Android Studio to run on a device/emulator or create a signed APK/AAB. The package ID is `app.xsutra.mobile` and the application label is `X-sutra`.

## Main commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite with the local public-API proxy |
| `npm run build` | Type-check and create the production bundle |
| `npm run build:artifacts` | Rebuild the standalone HTML and complete Netlify Drop ZIP from current `src/` |
| `npm run check` | Type-check without creating `dist/` |
| `npm run cap:sync` | Build web assets and copy them into Android |
| `npm run android:open` | Open the Android Studio project |
