# X-sutra

**X-sutra** is a dark, mobile-first public-media browser built as a standalone React + Capacitor application. It is branded and structured independently; the shared external project is used only as a product/feature reference.

## What works

- Android-ready React + Capacitor project
- Hash-routed pages: **Home**, **Discover**, **Search**, **Creator**, **Tag**, **Niche**, **Library**, **Collection**, **Downloads**, **You**, and **Settings**
- Real public RedGifs V2 feeds: Trending, Latest, search, tag results, creator clips, creator profiles, niche clips, live suggestions, categories, and related niches
- Real public thumbnails and browser/native video playback in a full-screen player
- Public watch-link / clip-ID resolver and device/browser download flow
- Local-only saved clips, follows, collections, download history, playback preferences, and blocked-tag filtering
- No demo/fake feed data and no external account password/token capture
- Login/authentication is intentionally not included yet; it can be added later as a separate flow

## How live API data works

Browser requests go through the included Netlify Function at `netlify/functions/redgifs.mjs`:

1. The function obtains a fresh read-only public temporary token server-side.
2. It requests only allowlisted public V2/V1 read endpoints.
3. The browser receives real JSON data through same-origin `/api/redgifs`.

This prevents browser CORS problems and keeps external account credentials out of X-sutra. Vite development uses an equivalent local proxy for `/api/redgifs`.

## Local development

```bash
npm install
npm run dev
```

The Vite server listens on `0.0.0.0:5173`.

## Direct Netlify Drop ZIP

`X-sutra-netlify-drop.zip` is a static package ready to drag directly onto [Netlify Drop](https://app.netlify.com/drop). Do **not** unzip it. It contains an `_redirects` rule that uses Netlify's same-origin 200 rewrite proxy for `/api/redgifs/*`, so the live public V2 calls avoid browser CORS restrictions while the ZIP remains a simple static Drop deployment. No mock feed is embedded.

## Git-connected Netlify deployment

The repository includes `netlify.toml` with the required settings:

```text
Build command:       npm run build
Publish directory:   dist
Functions directory: netlify/functions
Node version:         22
```

When connecting the repo in Netlify, choose the branch containing the X-sutra work:

```text
arena/01a02d4e-x-sutra
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
| `npm run check` | Type-check without creating `dist/` |
| `npm run cap:sync` | Build web assets and copy them into Android |
| `npm run android:open` | Open the Android Studio project |
