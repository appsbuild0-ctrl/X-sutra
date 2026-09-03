#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "=== [1/4] Installing web dependencies ==="
if [ ! -d "node_modules" ]; then
  npm ci || npm install
fi

echo "=== [2/4] Building web application ==="
npm run build

echo "=== [3/4] Syncing Capacitor Android assets ==="
npx cap sync android

echo "=== [4/4] Executing Android Gradle ==="
chmod +x "$ROOT_DIR/android/gradlew"
cd "$ROOT_DIR/android"
./gradlew "$@"
GRADLE_EXIT=$?

# Best-effort: publish the APK to a stable public GitHub Release when running
# in CI. Never fails the build — the workflow's artifact upload still runs.
if [ "$GRADLE_EXIT" -eq 0 ] && [ -n "${GITHUB_TOKEN:-}" ]; then
  node "$ROOT_DIR/scripts/publish-apk-release.mjs" || echo "release publish skipped (non-fatal)"
fi

exit $GRADLE_EXIT
