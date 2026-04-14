# AGENTS.md

## Cursor Cloud specific instructions

### Services overview

| Service | Dev command | Port | Notes |
|---|---|---|---|
| Backend (FastAPI) | `cd backend && uv run uvicorn app.main:app --reload --port 8000` | 8000 | Requires `GEMINI_API_KEY` env var or `backend/.env` |
| Frontend (SvelteKit) | `cd frontend && npm run dev` | 5173 | Vite proxy forwards `/api/chat/ws` → backend:8000 |

No database or Docker required for local development.

### Gotchas

- **Mermaid docs must be fetched before backend tests pass.** The backend fetches Mermaid syntax docs from GitHub on first startup (into `backend/app/docs/mermaid/`, gitignored). Six tests in `test_agent.py` depend on these docs existing. Either start the backend once before running tests, or run:
  ```
  cd backend && uv run python -c "import asyncio; from app.services.doc_fetcher import fetch_docs; asyncio.run(fetch_docs(force=True))"
  ```
- **`uv` must be on PATH.** Install via `curl -LsSf https://astral.sh/uv/install.sh | sh` — it goes to `~/.local/bin`.
- **Frontend Playwright e2e tests mock the WebSocket**, so they do not require the backend to be running. Playwright config auto-starts the Vite dev server.
- **`backend/.env`** is gitignored. Copy from `.env.example` and set `GEMINI_API_KEY`. Alternatively the env var can be set in the shell.

### Standard commands

See `README.md` for full setup. Quick reference:

- **Backend tests:** `cd backend && uv run pytest -v`
- **Backend lint:** `cd backend && uv run ruff check .`
- **Frontend type-check:** `cd frontend && npm run check`
- **Frontend e2e tests:** `cd frontend && npx playwright test`
- **Frontend build:** `cd frontend && npm run build`
