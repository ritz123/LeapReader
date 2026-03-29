#!/usr/bin/env bash
# Build the Android APK via Capacitor + Gradle.
# Usage:
#   bash scripts/build-android.sh          # debug APK (no keystore needed)
#   bash scripts/build-android.sh release  # signed release APK (needs keystore env vars)
#
# For a signed release build set these env vars before running:
#   export ANDROID_KEYSTORE_PATH=/path/to/keystore.jks
#   export ANDROID_KEYSTORE_PASSWORD=<password>
#   export ANDROID_KEY_ALIAS=<alias>
#   export ANDROID_KEY_PASSWORD=<password>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUILD_TYPE="${1:-debug}"

# ── Prerequisites ─────────────────────────────────────────────────────────────
if [[ ! -d node_modules ]]; then
  echo "Installing Node dependencies…"
  npm install
fi

if [[ -z "${ANDROID_HOME:-}" ]] && [[ -z "${ANDROID_SDK_ROOT:-}" ]]; then
  echo "ERROR: ANDROID_HOME (or ANDROID_SDK_ROOT) is not set." >&2
  echo "       Install Android SDK and set ANDROID_HOME, e.g.:" >&2
  echo "         export ANDROID_HOME=\$HOME/Android/Sdk" >&2
  exit 1
fi

if ! command -v java &>/dev/null; then
  echo "ERROR: Java not found. Install JDK 17+." >&2
  exit 1
fi

# ── Build web assets ──────────────────────────────────────────────────────────
echo "Building web app (tsc + vite)…"
npm run build

# ── Sync into Android project ─────────────────────────────────────────────────
echo "Syncing web assets into Android project…"
npx cap sync android

# ── Gradle build ──────────────────────────────────────────────────────────────
chmod +x android/gradlew

if [[ "$BUILD_TYPE" == "release" ]]; then
  echo "Building signed release APK…"
  if [[ -z "${ANDROID_KEYSTORE_PATH:-}" ]]; then
    echo "ERROR: ANDROID_KEYSTORE_PATH is not set for a release build." >&2
    exit 1
  fi
  cd android
  ./gradlew assembleRelease
  cd ..
  APK_PATH="$(ls android/app/build/outputs/apk/release/*.apk 2>/dev/null | head -1)"
else
  echo "Building debug APK…"
  cd android
  ./gradlew assembleDebug
  cd ..
  APK_PATH="$(ls android/app/build/outputs/apk/debug/*.apk 2>/dev/null | head -1)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
if [[ -n "$APK_PATH" && -f "$APK_PATH" ]]; then
  SIZE="$(du -h "$APK_PATH" | cut -f1)"
  echo ""
  echo "APK ready: $APK_PATH  ($SIZE)"
  echo ""
  echo "Install on a connected device:"
  echo "  adb install \"$APK_PATH\""
else
  echo "ERROR: APK not found — check Gradle output above." >&2
  exit 1
fi
