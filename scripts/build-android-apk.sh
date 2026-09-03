#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
npm run build
npx cap sync android
chmod +x android/gradlew
(cd android && ./gradlew assembleDebug --no-daemon)
echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
