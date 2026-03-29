#!/usr/bin/env bash
# Bump version in package.json, commit, tag, and push to trigger the GitHub
# Actions release workflow.
# Usage:
#   ./scripts/release.sh            # bump patch  (1.0.0 → 1.0.1)
#   ./scripts/release.sh minor      # bump minor  (1.0.0 → 1.1.0)
#   ./scripts/release.sh major      # bump major  (1.0.0 → 2.0.0)
#   ./scripts/release.sh 2.1.0      # set an explicit version
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUMP="${1:-patch}"

# npm version: updates package.json, commits the change, and creates a git tag.
npm version "$BUMP"

TAG="v$(node -p "require('./package.json').version")"

echo "Pushing version bump commit and tag $TAG…"
git push origin HEAD
git push origin "$TAG"

echo ""
echo "Done. GitHub Actions will now build and publish the release for $TAG."
echo "Track progress at: https://github.com/$(git remote get-url origin | sed 's|.*github.com[:/]\(.*\)\.git|\1|')/actions"
