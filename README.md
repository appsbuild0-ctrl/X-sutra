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
- Optional device-local login page (`#/login`) with username/password fields, sign-in / create-account modes, a show/hide password eye toggle, and a built-in admin account (`admin` / `admin123`) that opens the admin panel
- Premium section with fixed tabs (Home, Reels, Discover, Categories, Announcements), admin-managed channels/albums, and bulk URL import
- Discord as the Premium media source: map Discord channels onto Premium sections and anything posted or forwarded there appears in the app automatically (auto-sync + polling), streamed from the Discord CDN — no second upload, no second storage
- Uploaded and imported images render at their own aspect ratio and resolution — no CSS cropping
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

## Discord as the Premium media source

Post or forward an image/video into a mapped Discord channel and it shows up in
X-Sutra Premium by itself — there is no second upload. Configure
`DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` on the hosting provider (see
`.env.example`); the token never leaves the server.

```
Discord channel → Discord API → /api/discord/feed → X-Sutra Premium
```

1. **Mapping (Admin → Discord)** — pick which Discord channel feeds which
   Premium section, e.g. `#videos → Premium Videos`, `#images → Premium Images`,
   and choose images/videos per channel. New sections can be created inline.
2. **Auto-sync** — the feed endpoint (`GET /api/discord/feed`) re-reads a mapped
   channel when its interval has passed, using the stored message cursor so only
   *new* messages are fetched. The Premium screens also poll it (15–60 s) and a
   Netlify scheduled function (`netlify/functions/discord-cron.mjs`, `@every 10m`)
   covers the case where nobody has the app open. **Sync now** in the admin
   console forces one immediately; **Re-scan history** ignores the cursor.
3. **No second storage** — the catalog stores attachment metadata plus the
   Discord CDN link. `/api/discord/media?id=…` 302s the browser straight to
   Discord, so images and videos stream from the CDN. Discord signs those links
   and they expire, so the resolver re-reads the message and returns a fresh
   signature the moment the cached one is stale — no broken previews. Set
   `DISCORD_STORE_ATTACHMENTS=true` only if you want the bytes mirrored into the
   premium file store instead.
4. **Rules** — one row per attachment (a message with five images imports five),
   text-only messages are ignored, unsupported files (pdf, zip, audio) are
   skipped, duplicates are detected by `(channel, message, attachment)`, and
   Discord's own timestamps decide the order.
5. **Access** — Discord media only appears inside `/premium/library` and
   `/premium/channel/:id`, both behind the existing `PremiumOnly` role gate. The
   resolver only serves attachments that are already in the catalog, so it cannot
   be used to reach other channels, and the public feed response carries no bot
   details, cursors or error log.

Supported media: JPG/JPEG/PNG/WEBP/GIF images and MP4/WEBM/MOV videos (plus
anything Discord reports as `image/*` or `video/*`; the filename is the fallback
when `content_type` is missing). Images open in the viewer at their original
aspect ratio, videos open in the existing X-Sutra player.

The admin console also shows last successful sync, per-channel counts and an
error log.

## Tests

```bash
npm test
```

Node's built-in test runner over `scripts/tests/*.test.mjs`. It covers the
Discord import engine (channel discovery, attachment classification, catalog
merge, link vs store mode, cursor-based incremental reads, dedupe, time budget),
the whole auto-sync loop end-to-end against a stubbed Discord API — mapping,
incremental sync, read-time auto-sync throttling, CDN URL expiry refresh,
paging, the scheduled background sync and the error log — the `/api/discord/sync`
and `/api/discord/upload` handlers with a real local file store, the upload
form's assignment of many selected files to one channel, the premium catalog's
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
