#!/usr/bin/env bash
# Start the Electron desktop app (serves dist/ locally).
# Runs unit tests first — launch is aborted if any test fails.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies…"
  npm install
fi

echo "Running unit tests…"
npm test

echo "Building web app into dist/…"
npm run build

echo "Starting Leap reader (desktop)…"
exec npm run desktop:start
