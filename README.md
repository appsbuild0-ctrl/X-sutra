# RedGrab

**RedGrab** is a dark, mobile-first RedGifs downloader built as a standalone React + Capacitor application. Download GIFs, images and videos from RedGifs in HD or SD. Browse, search, save and play clips.

## What works

- Android-ready React + Capacitor project
- Hash-routed pages: **Home**, **Discover**, **Search**, **Creator**, **Tag**, **Niche**, **Library**, **Collection**, **Downloads**, **You**, **Login**, and **Settings**
- Real public RedGifs V2 feeds: Trending, Latest, search, tag results, creator clips, creator profiles, niche clips, live suggestions, categories, and related niches
- Real public thumbnails and browser/native video playback in a full-screen player
- Public watch-link / clip-ID resolver and device/browser download flow using the current media URL returned by the API
- Browser response validation rejects HTML/error documents instead of renaming them as video files; CORS-only fallbacks are reported as opened, not completed
- Local-only likes, saved clips, follows, collections, download history, autoplay/mute preferences, and blocked-tag filtering
- Optional device-local login page (`#/login`) with username/password fields, sign-in / create-account modes, a show/hide password eye toggle, and a built-in admin account () that opens the admin panel
- Premium section (Home + Library) with a Discord-style channel chat, admin-managed channels/albums and stored media
- **Discord media import** — post an image/video in any channel of the x-sutra Discord server and it appears in the Premium Library by itself (auto-sync, no upload, no mapping)
- **Real Discord web login for Premium** — the standard Discord OAuth2 account login: one tap, sign in on discord.com, done
- **Login stays logged in**: the session (profile + tokens) is stored on the device; the one-hour access token is renewed silently with the refresh token, so the user never sees the login screen again
- **Admin auto-connect**: when the local admin account is signed in, the Discord login is started automatically on first run (cancelled logins are not retried for 24 h)
- Uploaded images render at their own aspect ratio and resolution — no CSS cropping
- Local accounts store only a SHA-256 password hash on the device; the raw password is never persisted or transmitted
- No demo/fake feed data and no external account password/token capture

## How live API data works

Browser requests go through the included Netlify Function at `netlify/functions/redgifs.mjs`:

1. The function obtains a fresh read-only public temporary token server-side.
2. It requests only allowlisted public V2/V1 read endpoints.
3. The browser receives real JSON data through same-origin `/api/redgifs`.

This prevents browser CORS problems and keeps external account credentials out of RedGrab. The function requests the API with a stable app User-Agent (`RedGifs-Downloader/4.0`), which returns clean non-watermarked media URLs; the Drop ZIP bundles the same function instead of a header-forwarding rewrite. Vite development uses an equivalent local proxy for `/api/redgifs`. The Capacitor Android build uses Capacitor's native HTTP transport for the same temporary anonymous-token flow, because a packaged WebView has no deployed same-origin function. No private API key is bundled in either path.

## Local development

```bash
npm install
npm run dev
```

The Vite server listens on `0.0.0.0:5173`.

## Direct Netlify Drop ZIP

`RedGrab-netlify-drop.zip` is a static package ready to drag directly onto [Netlify Drop](https://app.netlify.com/drop). Do **not** unzip it. It contains the full production assets and an `_redirects` rule that uses Netlify's same-origin 200 rewrite proxy for `/api/redgifs/*`, so the live public V2 calls avoid browser CORS restrictions. No mock feed is embedded.

`X-sutra-standalone/` contains the same current UI as a single inlined `index.html` (legacy name preserved in build artifacts). Regenerate both tracked delivery artifacts from the current `src/` implementation with:

```bash
npm run build:artifacts
```

## Live deployment (Vercel)

Production runs on Vercel and is what the repository homepage points at:

```text
https://redgrab.vercel.app
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

## Discord media import (post on Discord → shows in Premium)

A small bot reads the **x-sutra** Discord server (default guild
`1542540297005834242`) and pulls every image/video posted into any channel —
**no mapping, no upload, no per-channel setup**. The Premium Library polls
`/api/discord/feed`; on every read the endpoint auto-syncs channels that are
due (default every 60 s) using stored cursors, so a file posted a moment ago
is already in the app. Media streams straight from the Discord CDN; set
`DISCORD_STORE_ATTACHMENTS=true` only if you want the bytes mirrored.

Setup (one time):

1. [Discord Developer Portal](https://discord.com/developers/applications) →
   your application → **Bot** → **Reset Token** → copy the token.
2. Same **Bot** tab → **Invite Your Bot** → tick *View Channel* and *Read
   Message History* → pick the x-sutra server → Authorize.
3. Set `DISCORD_BOT_TOKEN` on the hosting provider and redeploy.

The bot only reads: it needs no privileged intents (attachment metadata is
enough for images/videos; the message caption is used as the title when the
*Message Content* intent is on, the filename otherwise). One row per
attachment, text-only and unsupported files ignored, dedupe by
`(channel, message, attachment)`, transient failures retried on the next sync.

## Discord web login (Premium)

Premium is also entered with a **real Discord account** — the standard Discord
OAuth2 web login. Users tap **Login with Discord**, sign in on discord.com,
and land back in the app already connected.

```
Login with Discord → /api/discord/login → discord.com (sign in)
→ back to <origin>?code=…&state=… → /api/discord/callback → session saved
```

- **Persistent** — the session (profile + access token + refresh token) is
  stored on the device. Discord access tokens live ~1 h, so before that happens
  the app calls `/api/discord/refresh` in the background and swaps in a fresh
  pair. The login screen never reappears — until the user logs out or Discord
  revokes the token.
- **Admin auto-connect** — when the local admin account is signed in and no
  Discord session exists yet, the login flow starts by itself on app boot. If it
  is cancelled, no auto-redirect happens again for 24 h (no redirect loop).
- **Secrets stay server-side** — `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
  are only used inside the `discord-login`, `discord-callback` and
  `discord-refresh` functions. The browser sees a redirect, a code exchange and
  a refresh — never the secret.
- **Scoped down** — only `identify` + `offline_access` are requested (profile
  display + the refresh token). No email, no guild data, no messages.

Setup (one time, see `.env.example`):

1. Create an application at <https://discord.com/developers/applications>.
2. OAuth2 → copy the **Client ID** and **Client Secret** into
   `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` on the hosting provider.
3. OAuth2 → **Redirects**: add every origin the app is served from
   (`https://<netlify-domain>`, `https://<vercel-domain>`,
   `http://localhost:5173` for local dev).
4. Redeploy. Without the credentials the login card shows a friendly
   “not configured” notice instead of a broken redirect.

## Tests

```bash
npm test
```

Node's built-in test runner over `scripts/tests/*.test.mjs`. It covers the
Discord import engine (channel discovery, attachment classification, catalog
merge, cursor-based incremental reads, dedupe, the time budget), the Discord
web-login handlers end-to-end against a stubbed Discord API — the authorize
redirect (client id, root-origin redirect_uri, scopes, origin normalisation,
the unconfigured 501 page), the code→session exchange (secret sent
server-side only, public profile in, email/secret never out), the silent
refresh grant, and Discord error surfacing — plus the upload form's
assignment of many selected files to one channel, the premium catalog's
channel/media persistence, and the uncropped image display rules.

## Production build

```bash
npm run build
```

## Android sync

```bash
npm run cap:sync
npm run android:open
```

Open `android/` in Android Studio to run on a device/emulator or create a signed APK/AAB. The package ID is `app.redgrab.downloader` and the application label is `RedGrab`.

## Main commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite with the local public-API proxy |
| `npm run build` | Type-check and create the production bundle |
| `npm run build:artifacts` | Rebuild the standalone HTML and complete Netlify Drop ZIP from current `src/` |
| `npm run check` | Type-check without creating `dist/` |
| `npm test` | Run the Node test suite in `scripts/tests/` |
| `npm run cap:sync` | Build web assets and copy them into Android |
| `npm run android:open` | Open the Android Studio project |
