# Android Release Signing — X-Sutra

The GitHub Actions workflow (`.github/workflows/main.yml`) builds the release APK and **signs it** with a
release keystore so it can be installed on any Android device. Without the secrets below, the workflow fails
fast with a clear error (Gradle alone produces `app-release-unsigned.apk`, which Android refuses to install).

## One-time setup (repo owner)

Go to **Repository → Settings → Secrets and variables → Actions → New repository secret** and add these 4 secrets:

| Secret name                | Value                                                        |
| -------------------------- | ------------------------------------------------------------ |
| `ANDROID_KEYSTORE_BASE64`  | base64 of `xsutra-release.keystore` (single line, see below) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password                                            |
| `ANDROID_KEY_ALIAS`        | `xsutra`                                                     |
| `ANDROID_KEY_PASSWORD`     | same as keystore password (PKCS12 keystores use one password) |

The exact values are delivered out-of-band with the keystore backup (`.signing-local/SIGNING_SECRETS_FOR_GITHUB.md`
in the session where signing was set up). **Keep the keystore + passwords backed up safely and privately —
if the keystore is lost, the app can never be updated again under the same identity.**

## How the workflow works

1. Builds the web app and syncs Capacitor, then runs `assembleRelease` (produces the unsigned APK).
2. Decodes `ANDROID_KEYSTORE_BASE64` to a temporary keystore (never written to the repo or artifacts).
3. `zipalign` → `apksigner sign` (v1 + v2 signatures) → `apksigner verify --print-certs`.
4. Uploads `X-Sutra-release-signed.apk` as the `X-Sutra-signed-APK` artifact.

To build manually: **Actions → Build APK → Run workflow**.

## Regenerating the keystore (only if starting a NEW app identity)

```bash
openssl req -x509 -newkey rsa:2048 -keyout xsutra-key.pem -out xsutra-cert.pem -days 10000 -nodes \
  -subj "/CN=X-Sutra App/OU=Mobile/O=X-Sutra/C=US"
openssl pkcs12 -export -in xsutra-cert.pem -inkey xsutra-key.pem -name xsutra \
  -out xsutra-release.keystore -passout "pass:YOUR_PASSWORD"
base64 -w0 xsutra-release.keystore   # -> this line goes into ANDROID_KEYSTORE_BASE64
```

> ⚠️ Rotating the key changes the app identity: existing installs cannot be updated, only uninstalled + reinstalled,
> and any Play-Store-style distribution would reject the update. Only do this before first public release.
