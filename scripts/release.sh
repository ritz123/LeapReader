#!/usr/bin/env bash
# Tag a new release and push it to trigger the GitHub Actions release workflow.
# Usage:
#   ./scripts/release.sh           # auto-increments the patch version (e.g. v1.0.0 → v1.0.1)
#   ./scripts/release.sh v2.0.0    # use an explicit version tag
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -ge 1 ]]; then
  TAG="$1"
else
  # Read current version from package.json and bump the patch number.
  CURRENT="$(node -p "require('./package.json').version")"
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  TAG="v${MAJOR}.${MINOR}.$((PATCH + 1))"
fi

# Ensure tag starts with 'v'.
if [[ "$TAG" != v* ]]; then
  TAG="v${TAG}"
fi

echo "Creating tag: $TAG"
git tag "$TAG"

echo "Pushing tag to origin…"
git push origin "$TAG"

echo "Done. GitHub Actions will now build and publish the release for $TAG."
echo "Track progress at: https://github.com/$(git remote get-url origin | sed 's|.*github.com[:/]\(.*\)\.git|\1|')/actions"
