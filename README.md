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
