#!/usr/bin/env bash
# Build desktop distribution packages (Linux AppImage + .deb by default).
# Optional args are passed to electron-builder after --linux, e.g.:
#   ./scripts/build-dist.sh              # all Linux targets from package.json
#   ./scripts/build-dist.sh AppImage     # AppImage only
#   ./scripts/build-dist.sh deb          # .deb only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies…"
  npm install
fi

if [[ ! -f build/icons/icon.png ]]; then
  echo "Warning: build/icons/icon.png missing — window / package icons may be wrong." >&2
fi

echo "Building web app (tsc + vite)…"
npm run build

if [[ $# -eq 0 ]]; then
  echo "Packaging (all Linux targets from package.json)…"
  exec npx electron-builder --linux
fi
echo "Packaging: electron-builder --linux $*…"
exec npx electron-builder --linux "$@"
