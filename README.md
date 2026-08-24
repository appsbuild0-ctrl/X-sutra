# X-sutra

**X-sutra** is a dark, mobile-first public-media browser built as a standalone React + Capacitor application. It is branded and structured independently; the shared external project is used only as a product/feature reference.

## What works

- Android-ready React + Capacitor project
- Hash-routed pages: **Home**, **Discover**, **Search**, **Creator**, **Tag**, **Niche**, **Library**, **Collection**, **Downloads**, **You**, and **Settings**
- Real public RedGifs V2 feeds: Trending, Latest, search, tag results, creator clips, creator profiles, niche clips, live suggestions, categories, and related niches
- Real public thumbnails and browser/native video playback in a full-screen player
- Public watch-link / clip-ID resolver and device/browser download flow using the current media URL returned by the API
- Browser response validation rejects HTML/error documents instead of renaming them as video files; CORS-only fallbacks are reported as opened, not completed
- Local-only likes, saved clips, follows, collections, download history, autoplay/mute preferences, and blocked-tag filtering
- No demo/fake feed data and no external account password/token capture
- Login/authentication is intentionally not included yet; it can be added later as a separate flow

## How live API data works

Browser requests go through the included Netlify Function at `netlify/functions/redgifs.mjs`:

1. The function obtains a fresh read-only public temporary token server-side.
2. It requests only allowlisted public V2/V1 read endpoints.
3. The browser receives real JSON data through same-origin `/api/redgifs`.

This prevents browser CORS problems and keeps external account credentials out of X-sutra. Vite development uses an equivalent local proxy for `/api/redgifs`. The Capacitor Android build uses Capacitor's native HTTP transport for the same temporary anonymous-token flow, because a packaged WebView has no deployed same-origin function. No private API key is bundled in either path.

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
| `npm run server` | Run the secure backend standalone (same handlers as Vite/Netlify) |
| `npm run test:telegram` | End-to-end test of the media backend against a local Telegram Bot API mock |
| `npm run test:dev` | End-to-end test of the media API through the real Vite dev server |

## Studio — private Telegram media storage

X-sutra now has an **admin Studio** for uploading your own media. Telegram is used
**only as hidden storage**; it is never shown to normal users and its credentials
never reach the browser.

### How it works

```
ADMIN  ──▶  Secure backend (Vite dev plugin / Netlify Function)
                     │
                     ▼
              Telegram Bot API  ──▶  PRIVATE Telegram channel (media bytes)
                     │                      │
                     ▼                      ▼
              Media metadata store    file_id / message_id reference
                     │
                     ▼
              MY APP  ──▶  NORMAL USERS see images / video / files (view, play, download)
```

- **Admin** signs in with a password. The backend issues an `HttpOnly`,
  `SameSite=Strict` session cookie. Only admin requests may upload or delete.
- **Normal users** see uploaded media in the app (Home feed + the Studio tab) and
  can view, play, and download — but they cannot upload, cannot reach Telegram,
  and never see the bot token, chat id, or any storage credentials.
- Uploads go `Admin panel → backend → Telegram private channel`. The backend stores
  only **metadata/references** (no large bytes in the database). The app then
  streams the real bytes back through the backend, so the Telegram token stays
  server-side.

### Backend architecture (follows the existing pattern)

The same handler code (`server/api.mjs`, `server/telegram.mjs`, `server/store.mjs`,
`server/auth.mjs`) runs in three places:

1. **Local dev** — the Vite plugin `secureMediaProxy` in `vite.config.ts` mounts
   `/api/media` and `/api/admin`.
2. **Netlify** — `netlify/functions/media.mjs` (redirects in `netlify.toml`).
3. **Standalone** — `npm run server` (a plain Node server) if you self-host.

No external storage/database provider is used: **no Supabase, no Cloudinary, no
Firebase, no R2.** Telegram is the only storage layer. Metadata lives in a JSON
store under `XSUTRA_DATA_DIR` (default `./server/data`). On Netlify you can opt into
the host-provided Netlify Blobs for persistence by installing `@netlify/blobs` and
setting `XSUTRA_STORE=blobs`; otherwise the local file store is used.

### Endpoints

- `POST /api/admin/login` · `POST /api/admin/logout` · `GET /api/admin/session`
- `POST /api/media/upload` (admin only, multipart, real progress)
- `GET /api/media` · `GET /api/media/:id` (public)
- `GET /api/media/:id/stream` (public video/image, range-aware)
- `GET /api/media/:id/thumbnail` (public poster)
- `GET /api/media/:id/file` (public download, `Content-Disposition: attachment`)
- `DELETE /api/media/:id` (admin only)

### Environment variables (server-side only)

Copy `.env.example` to `.env` (or set them in your host). **None of these are ever
bundled into the frontend, placed in `localStorage`, or sent to the browser.**

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot token for the storage bot. **Never exposed to clients.** |
| `TELEGRAM_STORAGE_CHAT_ID` | Private channel / storage chat id (the bot must be a member with post permission). |
| `ADMIN_PASSWORD` | Password that unlocks the Studio upload panel. |
| `ADMIN_SESSION_SECRET` | Secret used to sign the admin session cookie. Use a long random value. |
| `TELEGRAM_API_BASE` | Optional. Point at a self-hosted Local Bot API Server to raise the ~20 MB bot-download ceiling (and 50 MB upload ceiling) to ~2 GB. Defaults to `https://api.telegram.org`. |
| `XSUTRA_DATA_DIR` | Optional. Where the media metadata JSON store is written. |
| `XSUTRA_STORE` | Optional. `file` (default) or `blobs` (Netlify Blobs). |

To deploy: set the four required variables on your backend (Netlify site env or your
host), create a **private** Telegram channel, add the bot as an admin, and restart.
No code changes and no URL copying are needed — uploaded media appears in the app
automatically.

### File-size limits (real Telegram Bot API limits)

- Photos: **10 MB**
- Videos / documents / files: **50 MB**

These are enforced on upload. (The standard public Bot API caps bot *downloads* at
~20 MB; files above that need `TELEGRAM_API_BASE` pointing at a Local Bot API Server.)

