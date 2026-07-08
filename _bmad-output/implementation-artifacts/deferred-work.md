# Deferred Work

## Deferred from: code review (2026-07-07)

- **F-03 — Ollama binary downloaded without checksum or signature verification** (`backend/ollama_manager.py` lines 349–365): The binary is fetched from GitHub with no SHA-256 or GPG check. Requires per-release checksum pinning. Deferred as out-of-scope for initial sprint; acceptable for local dev/beta but must be addressed before public distribution.

- **F-18 — Context extraction limits are uncoordinated across endpoints** (`backend/context_utils.py`, `src/reader/ai-context.ts`): Chat uses 32 000-char frontend pre-trim + backend re-trim (no-op). Review uses 50 000-char backend extract with no token-budget guard. Inconsistent but intentional during initial sprint; requires a unified context budget API tuned per model.

- **EC-16 — `stop_ollama` calls `proc.wait(timeout=5)` synchronously inside an `async` function** (`backend/ollama_manager.py` ~line 504): Blocks the event loop for up to 5 s at shutdown. Only fires during app quit; low user-facing impact. Deferred because refactoring this requires `run_in_executor` or asyncio subprocess APIs.
