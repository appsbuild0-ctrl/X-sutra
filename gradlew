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
exec ./gradlew "$@"
