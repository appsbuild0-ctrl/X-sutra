# Android Release Signing — X-Sutra

Release APKs are **signed**, so they install on any Android device. Signing is configured in
`android/app/build.gradle` (`signingConfigs.release` + `buildTypes.release.signingConfig`), reading:

| File | Purpose |
| ---- | ------- |
| `android/app/xsutra-release.keystore` | PKCS12 release keystore (RSA-2048, valid until 2054) |
| `android/app/release-signing.properties` | `storeFile` / passwords / alias |

**Both files are intentionally committed** — the repo is private and this lets the GitHub Actions
workflow (`main.yml` → `./gradlew assembleRelease`) produce a signed APK (`app-release.apk`) with
**zero manual setup**: no GitHub secrets, no workflow changes. If the keystore files are ever missing,
the build still succeeds but logs a warning and produces an unsigned APK (never a silent surprise —
check for `UNSIGNED` in the log).

## How a build works

1. Push to `main` (or **Actions → Build APK → Run workflow**).
2. `gradlew` builds the web app → `cap sync android` → `assembleRelease`.
3. Gradle signs with the committed keystore (v1 + v2 signatures).
4. Artifact **X-Sutra-APK** → `app-release.apk` is the **signed, installable** APK.

Verify a downloaded APK any time: `apksigner verify --print-certs app-release.apk`
(or `keytool -printcert -jarfile app-release.apk`).

## Security notes

- The committed keystore means anyone with **repo read access can sign as this app**. Fine for a
  private repo distributing APKs directly; before the repo is ever made public or the app goes to a
  store, migrate to GitHub Secrets (see below) and rotate the key first if needed.
- **Never lose the keystore**: same-identity updates become impossible. Keep the offline backup from
  `.signing-local/` (or the PR #26 setup comment) somewhere safe.

## Migrating to GitHub Secrets (when repo stops being private)

1. Add secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
   `ANDROID_KEY_PASSWORD` (values in the offline backup).
2. Update `.github/workflows/main.yml` to decode the keystore into a temp path and inject passwords
   via env/`-P` gradle properties instead of the committed files, then **remove** the committed
   keystore + properties and the `.gitignore` exceptions. Paste-ready workflow for this lives in
   `.signing-local/WORKFLOW-main.yml.paste.txt` (and in the PR #26 setup comment).
