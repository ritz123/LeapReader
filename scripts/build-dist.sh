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

# Ensure packaging icons exist. Linux Mint and other desktop environments require 
# a high-res PNG for the application launcher icon.
mkdir -p build/icons
if [[ ! -f build/icons/icon.png ]]; then
  if [[ -f public/icon.png ]]; then
    echo "Setting up packaging icon from public/icon.png…"
    cp public/icon.png build/icons/icon.png
  else
    echo "Warning: No icon source found. The application launcher icon may be missing." >&2
  fi
fi

echo "Building web app (tsc + vite)…"
npm run build

if [[ $# -eq 0 ]]; then
  echo "Packaging (all Linux targets from package.json)…"
  exec npx electron-builder --linux
fi
echo "Packaging: electron-builder --linux $*…"
exec npx electron-builder --linux "$@"
