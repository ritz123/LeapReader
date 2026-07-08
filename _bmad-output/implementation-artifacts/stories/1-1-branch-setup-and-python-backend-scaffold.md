# Story 1.1: Branch Setup and Python Backend Scaffold

---
baseline_commit: b6a30d35ae1c8797ed88e364e9567177af2e2556
---

Status: review

## Story

As a developer,
I want a dedicated feature branch with the Python backend directory structure and build configuration in place,
so that all subsequent AI stories have a clean, isolated foundation that does not affect the main branch or Android/web builds.

## Acceptance Criteria

1. **Given** the repository is on `main` **When** the developer creates/confirms `feature/ai-assistant` branch (already exists as `ai`) **Then** all AI work lands on `ai` branch, not `main`.

2. **Given** the feature branch is checked out **When** the developer inspects the project **Then** these exist: `backend/main.py` (FastAPI app skeleton with `/health`), `backend/pyproject.toml` (pinned deps), `electron/ai-bridge.mjs` (stub comment scaffold), `assets/review-prompt.md` (placeholder prompt).

3. **Given** `package.json` on the `ai` branch **When** `electron-builder` runs **Then** `extraResources` includes an entry for `backend/` (mapped to `resources/backend`) and `assets/` (mapped to `resources/assets`), while `main` branch `package.json` remains unmodified.

4. **Given** the developer runs `uv sync` inside `backend/` **When** the command completes **Then** `.venv/` is created and `uv run python -c "import fastapi, uvicorn, ollama, pypdf, ddgs, requests"` exits 0.

## Tasks / Subtasks

- [x] Task 1: Confirm and checkout `ai` branch (AC: 1)
  - [x] Run `git checkout ai` — branch already exists; verify it's at same commit as main
  - [x] Record baseline_commit from `git rev-parse HEAD`

- [x] Task 2: Create Python backend skeleton (AC: 2, 4)
  - [x] Create `backend/pyproject.toml` with pinned dependencies (FastAPI 0.139.0, uvicorn 0.50.2, ollama 0.6.2, pypdf >=4.0, ddgs 9.14.4, requests, python >=3.11)
  - [x] Create `backend/main.py` — FastAPI app with `GET /health` returning `{"status":"ok","version":"0.1.0"}`
  - [x] Run `uv sync` in `backend/` and verify import check passes

- [x] Task 3: Create Electron AI bridge stub (AC: 2)
  - [x] Create `electron/ai-bridge.mjs` with module scaffold (exports `startBackend`, `stopBackend`) — stub implementations that resolve immediately (full logic comes in Story 1.2)

- [x] Task 4: Create assets placeholder (AC: 2)
  - [x] Create `assets/review-prompt.md` with a placeholder heading and `<!-- TODO: Story 3.2 fills this in -->` comment

- [x] Task 5: Update `package.json` extraResources (AC: 3)
  - [x] Add two entries to `build.extraResources`: `{from:"backend", to:"backend", filter:["**/*", "!**/__pycache__/**", "!**/.venv/**"]}` and `{from:"assets", to:"assets", filter:["**/*"]}`
  - [x] Verify `main` branch `package.json` does NOT contain these entries (the change is branch-isolated)

- [x] Task 6: Run existing test suite to confirm no regressions (AC: all)
  - [x] Run `npm test` and confirm all existing tests pass

## Dev Notes

### Branch Strategy (AD-12)
- The AI feature lives entirely on branch `ai` (already exists, matches name from Architecture AD-12 `feature/ai-assistant`). Never commit AI code to `main`.
- Android (`scripts/build-android.sh`) and web builds are untouched — they reference `main`.

### Python Tooling
- Use `uv` (not pip/poetry). `uv sync` reads `backend/pyproject.toml` and creates `backend/.venv/`.
- Check `uv` is available: `which uv`. If not, `curl -LsSf https://astral.sh/uv/install.sh | sh`.
- Python version: >=3.11 (uv will download it if needed).
- Pinned versions from Architecture Spine: FastAPI==0.139.0, uvicorn==0.50.2, ollama==0.6.2, ddgs==9.14.4.

### Package.json extraResources (AD-9, Architecture §Build)
- The `build.extraResources` array already has one entry (for `build/icons`). Append; do not replace.
- Filter pattern `!**/.venv/**` prevents bundling the 200 MB+ virtualenv — only source is bundled; the installer runs `uv sync` post-install.
- Electron-builder copies `extraResources` into `resources/` inside the ASAR-excluded dir. At runtime: `process.resourcesPath + "/backend"`.

### Existing Package.json structure
- The existing `build.extraResources` array is at `package.json:build.extraResources` and already has one entry for `build/icons → icons`.
- Do NOT modify `files` array — it handles the Electron/Vite built output.

### FastAPI /health endpoint
- Must return JSON: `{"status": "ok", "version": "0.1.0"}` with HTTP 200.
- No auth, no body required.
- This is the heartbeat that `ai-bridge.mjs` polls (Story 1.2).

### Testing
- Existing tests use **vitest** (`npm test` → `vitest run`). All are TypeScript tests in `tests/`.
- No Python tests are required for this story (just the import smoke-check via uv run).
- The new `backend/` and `assets/` directories are ignored by vitest (it only scans `src/` and `tests/`).

### Project Structure Notes
```
LeapReader/
├── ai                     ← work branch (already exists)
├── backend/               ← NEW (this story)
│   ├── pyproject.toml     ← NEW
│   └── main.py            ← NEW
├── assets/                ← NEW (this story)
│   └── review-prompt.md   ← NEW placeholder
├── electron/
│   ├── main.mjs           ← existing, DO NOT MODIFY in this story
│   ├── preload.cjs        ← existing, DO NOT MODIFY in this story
│   └── ai-bridge.mjs      ← NEW stub (this story)
└── package.json           ← MODIFY: add extraResources entries
```

### References
- [Source: ARCHITECTURE-SPINE.md#AD-12] Branch isolation — all AI on `feature/ai-assistant`
- [Source: ARCHITECTURE-SPINE.md#AD-9] Ollama binary storage, `extraResources` structure
- [Source: ARCHITECTURE-SPINE.md#Stack] Pinned library versions
- [Source: epics.md#Story-1.1] Acceptance criteria and scope

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-5

### Debug Log References

### Completion Notes List

- ✅ `ai` branch confirmed at baseline_commit b6a30d3
- ✅ `backend/pyproject.toml` created with FastAPI 0.139.0, uvicorn 0.50.2, ollama 0.6.2, pypdf 6.14.2, ddgs 9.14.4. Note: `requests` version relaxed to `>=2.28` due to custom PyPI mirror constraint (Nokia Artifactory has 2.28.1 only).
- ✅ `uv sync` passed: 33 packages installed including all required deps
- ✅ Import smoke-check passed: `import fastapi, uvicorn, ollama, pypdf, ddgs, requests` — ALL_OK
- ✅ `electron/ai-bridge.mjs` stub created with `startBackend`, `stopBackend`, `getBackendPort` exports
- ✅ `assets/review-prompt.md` placeholder created
- ✅ `package.json` extraResources updated with `backend/` and `assets/` entries
- ✅ 73/73 existing vitest tests pass — zero regressions

### File List

- backend/pyproject.toml (NEW)
- backend/main.py (NEW)
- electron/ai-bridge.mjs (NEW)
- assets/review-prompt.md (NEW)
- package.json (MODIFIED — extraResources)
