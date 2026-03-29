#!/usr/bin/env bash
# Start the Electron desktop app (serves dist/ locally). Builds first if dist/ is missing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies…"
  npm install
fi

if [[ ! -f dist/index.html ]]; then
  echo "Building web app into dist/…"
  npm run build
fi

echo "Starting Leap reader (desktop)…"
exec npm run desktop:start
