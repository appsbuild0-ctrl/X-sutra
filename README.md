# X-sutra

A standalone, dark-ember Android media browser built for **X-sutra**. It uses public media endpoints for browsing and downloads, while saved items, download history, preferences, and the optional display-name profile remain local to the device.

> The external project shared for direction was used only as a product reference. This repository is branded and structured as X-sutra, with no external-account login or credential capture flow.

## Included experience

- Android-ready React + Capacitor app
- Five working bottom tabs: **Home**, **Discover**, **Library**, **Downloads**, and **You**
- Public Trending / For-you-style feeds with search, topics, creator browsing, and a full-screen player
- Public watch-link / clip-ID resolver and download action
- Local saved library and persisted download history
- Simple local profile on the final **You** tab — no password, third-party login, or account token is stored
- Download quality and autoplay preferences
- Graceful interactive preview data when a public API is unavailable
- Responsive web preview for UI iteration before creating an APK

## Run the UI locally

```bash
npm install
npm run dev
```

The Vite server listens on `0.0.0.0:5173` and can be viewed in a browser or the live Arena preview.

## Build the web bundle

```bash
npm run build
```

## Sync and open the Android project

```bash
npm run cap:sync
npm run android:open
```

Open `android/` in Android Studio to run on a device/emulator or create a signed APK/AAB. The native project uses the package ID `app.xsutra.mobile` and application label `X-sutra`.

> Android compilation requires a local JDK and Android SDK / Android Studio. The source project and Capacitor sync are included in this repository.

## Data and privacy

- Public browsing uses temporary public API access only.
- X-sutra never asks for an external site password or captures account credentials.
- Local profile name, saved clips, download history, and preferences are held in browser/device storage.
- Download behavior depends on the source file being public and the platform permitting that public file download.

## Main commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the responsive UI preview |
| `npm run build` | Type-check and create `dist/` |
| `npm run check` | Type-check without building |
| `npm run cap:sync` | Build web assets and copy them into Android |
| `npm run android:open` | Open the Android Studio project |
