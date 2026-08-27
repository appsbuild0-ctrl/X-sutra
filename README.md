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

- **Discord-backed Premium content**: admins upload files from the panel; the backend posts them to a configured Discord channel and maps the real message id in PostgreSQL

## Discord integration (no Telegram)

X-Sutra no longer depends on Telegram in any way. Content storage/delivery for Premium uses the
**Discord Bot REST API**, called server-side from the existing backend — there is **no** long-running
WebSocket bot, no separate hosting, no Telegram login/OTP/session, and no Discord OAuth.

Flow: **Admin → X-Sutra backend → Discord REST API → your Discord bot → configured channel.**

| Route | Purpose |
| --- | --- |
| `GET /api/discord/media` | published content (display fields only — no token, no guild/channel/message ids) |
| `POST /api/discord/media` | admin-only (X-Sutra admin password): `status` / `start` / `chunk` / `finish` / `list` / `delete` |
| `POST /api/discord/status` | admin health check: API / guild / channel / permissions, never the token |

### Environment variables (Vercel)

`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`, `DISCORD_ADMIN_USER_ID`
(+ `DATABASE_URL`, `AUTH_JWT_SECRET`, optional `DISCORD_MAX_UPLOAD_MB`, `PREMIUM_ADMIN_PASSWORD`).
All are server-side only; none are bundled, rendered, or returned to the browser.

### Bot permissions (minimum)

View Channel, Send Messages, Attach Files, Read Message History, Embed Links, and Manage Messages
(for deletion). Nothing more.

### Upload / delete behaviour

- A Discord message is created **first**; the DB row (`xs_discord_media`) is written only after Discord
  returns a real message id. A Discord failure never marks a success and never leaves a fake row.
- Files larger than the Discord limit (8 MB default) are rejected with a clear message.
- Deletion removes the real Discord message (an already-deleted message is handled gracefully) and then
  updates the DB.
- Rate limits (HTTP 429 + `retry_after`) are retried a bounded number of times — never an infinite loop.

### Verification

```bash
npm run check:discord   # real handler + REST logic, in-memory pg + scripted Discord API
npm run check           # tsc --noEmit
npm run build
```

Live Discord calls require your real bot token in the deployed environment; the sandbox used for
development cannot reach discord.com, so the production round-trip must be confirmed once after deploy.


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

Vercel builds `main` for production and every pull request for preview (preview URLs are behind Vercel Authentication, so open them while logged in to the Vercel account). The backend is shared with Netlify: `api/[...path].mjs` routes `/api/*` to the handlers in `netlify/functions/`, with dedicated filesystem functions for the nested `/api/discord/media` and `/api/discord/status` paths. Frontend requests use same-origin relative `/api/...` paths, so there is no `BACKEND_URL` setting and no separate backend deployment to configure. Configure the variables from `.env.example` in the Vercel project — without `DATABASE_URL` the Discord message mapping has nowhere to live, and without `DISCORD_BOT_TOKEN` the status endpoint reports the missing names.

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
