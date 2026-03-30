#!/usr/bin/env bash
# Validate a built AppImage before publishing a GitHub Release.
#
# Usage:
#   bash scripts/test-appimage.sh                    # auto-finds release/*.AppImage
#   bash scripts/test-appimage.sh path/to/App.AppImage [expected-version]
#
# Exit code 0 = all tests passed.  Non-zero = at least one test failed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0

pass() { echo "  PASS  $*"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL  $*" >&2; FAIL=$((FAIL + 1)); }
section() { echo; echo "── $* ──"; }

# ── Locate the AppImage ─────────────────────────────────────────────────────
APPIMAGE="${1:-}"
EXPECTED_VERSION="${2:-}"

if [[ -z "$APPIMAGE" ]]; then
  APPIMAGE="$(ls release/*.AppImage 2>/dev/null | head -1 || true)"
fi

if [[ -z "$APPIMAGE" || ! -f "$APPIMAGE" ]]; then
  echo "ERROR: No AppImage found. Build first with: npm run build:dist" >&2
  exit 1
fi

echo "Testing: $APPIMAGE"

# ── Unit tests (run before touching the AppImage) ────────────────────────────
section "Unit tests"
cd "$ROOT"
if npm test; then
  pass "All unit tests passed"
else
  fail "Unit tests failed — aborting AppImage validation"
  exit 1
fi

# ── Test 1: basic file checks ────────────────────────────────────────────────
section "File"

if [[ -f "$APPIMAGE" ]]; then
  pass "AppImage file exists"
else
  fail "AppImage file not found: $APPIMAGE"
fi

if [[ -x "$APPIMAGE" ]]; then
  pass "AppImage is executable"
else
  fail "AppImage is not executable"
  chmod +x "$APPIMAGE"
  echo "       (auto-fixed with chmod +x)"
fi

# ── Extract the AppImage ─────────────────────────────────────────────────────
WORKDIR="$(mktemp -d)"
trap "rm -rf '$WORKDIR'" EXIT

APPIMAGE_ABS="$(realpath "$APPIMAGE")"
cd "$WORKDIR"

section "Extraction"
if "$APPIMAGE_ABS" --appimage-extract > /dev/null 2>&1; then
  pass "AppImage extracts without error"
else
  fail "AppImage extraction failed"
fi

SQUASH="$WORKDIR/squashfs-root"

# ── Test 2: AppRun entry point ───────────────────────────────────────────────
section "AppRun"
if [[ -f "$SQUASH/AppRun" ]]; then
  pass "AppRun entry point exists"
else
  fail "AppRun entry point missing"
fi

# ── Test 3: app.asar ─────────────────────────────────────────────────────────
section "app.asar"
ASAR="$SQUASH/resources/app.asar"

if [[ -f "$ASAR" ]]; then
  pass "resources/app.asar exists"
else
  fail "resources/app.asar not found — app was not packaged correctly"
  echo
  echo "Tests complete: $PASS passed, $FAIL failed."
  exit 1
fi

# List asar contents (install @electron/asar if needed)
if ! npx --yes @electron/asar list "$ASAR" > /tmp/asar-contents.txt 2>/dev/null; then
  fail "Could not read app.asar contents"
  echo
  echo "Tests complete: $PASS passed, $FAIL failed."
  exit 1
fi

# ── Test 4: dist/ web assets ─────────────────────────────────────────────────
section "Web assets (dist/)"

for REQUIRED_FILE in \
    "/dist/index.html" \
    "/dist/assets"; do
  if grep -q "^${REQUIRED_FILE}" /tmp/asar-contents.txt; then
    pass "$REQUIRED_FILE present in asar"
  else
    fail "$REQUIRED_FILE MISSING from asar — 'npm run build' was not run before packaging"
  fi
done

# ── Test 5: Electron main process files ──────────────────────────────────────
section "Electron main process"

for REQUIRED_FILE in \
    "/electron/main.mjs" \
    "/electron/preload.cjs" \
    "/package.json"; do
  if grep -q "^${REQUIRED_FILE}$" /tmp/asar-contents.txt; then
    pass "$REQUIRED_FILE present in asar"
  else
    fail "$REQUIRED_FILE MISSING from asar"
  fi
done

# ── Test 6: version consistency ───────────────────────────────────────────────
section "Version"

# Extract package.json from the asar to read the bundled version.
# extract-file writes to the current directory, so cd into WORKDIR first.
(cd "$WORKDIR" && npx --yes @electron/asar extract-file "$ASAR" package.json 2>/dev/null) || true

if [[ -f "$WORKDIR/package.json" ]]; then
  BUNDLED_VERSION="$(node -p "require('$WORKDIR/package.json').version" 2>/dev/null || echo "")"
  pass "Bundled version: $BUNDLED_VERSION"

  # Check AppImage filename contains the version.
  APPIMAGE_BASENAME="$(basename "$APPIMAGE_ABS")"
  if echo "$APPIMAGE_BASENAME" | grep -qF "$BUNDLED_VERSION"; then
    pass "AppImage filename matches bundled version ($BUNDLED_VERSION)"
  else
    fail "AppImage filename '$APPIMAGE_BASENAME' does not contain version '$BUNDLED_VERSION'"
  fi

  # If an expected version was provided (e.g. from the git tag), check it matches.
  if [[ -n "$EXPECTED_VERSION" ]]; then
    EXPECTED_CLEAN="${EXPECTED_VERSION#v}"  # strip leading 'v'
    if [[ "$BUNDLED_VERSION" == "$EXPECTED_CLEAN" ]]; then
      pass "Bundled version matches expected tag ($EXPECTED_VERSION)"
    else
      fail "Version mismatch: bundled='$BUNDLED_VERSION', tag='$EXPECTED_VERSION'"
    fi
  fi
else
  fail "Could not extract package.json from asar (check that @electron/asar is available)"
fi

# ── Test 7: smoke launch (requires Xvfb) ────────────────────────────────────
section "Smoke launch"

if command -v xvfb-run > /dev/null 2>&1; then
  LAUNCH_LOG="$(mktemp)"
  # Run for 8 seconds; exit 124 = timeout (app was still alive) = good.
  timeout 8 xvfb-run --auto-servernum -- \
    "$APPIMAGE_ABS" --no-sandbox --disable-gpu \
    > "$LAUNCH_LOG" 2>&1 || LAUNCH_EXIT=$?
  LAUNCH_EXIT="${LAUNCH_EXIT:-0}"

  if grep -q "Missing dist/" "$LAUNCH_LOG"; then
    fail "App reported missing dist/ folder — web assets not bundled correctly"
    cat "$LAUNCH_LOG" >&2
  else
    pass "App started without 'Missing dist/' error"
  fi

  if [[ "$LAUNCH_EXIT" -eq 124 ]]; then
    pass "App stayed running for 8 seconds (killed by timeout as expected)"
  elif [[ "$LAUNCH_EXIT" -eq 0 ]]; then
    pass "App exited cleanly"
  else
    fail "App crashed with exit code $LAUNCH_EXIT"
    cat "$LAUNCH_LOG" >&2
  fi

  rm -f "$LAUNCH_LOG"
else
  echo "  SKIP  Xvfb not available — skipping launch test"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo "────────────────────────────────"
echo "  Results: $PASS passed, $FAIL failed"
echo "────────────────────────────────"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
