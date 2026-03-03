# Mermaid Agent

An AI-powered Mermaid diagram tool. Describe a diagram in natural language and get live-rendered Mermaid code you can edit interactively.

## Stack

- **Backend**: Python / FastAPI + OpenAI-compatible API
- **Frontend**: SvelteKit + CodeMirror 6 (`codemirror-lang-mermaid`) + Mermaid.js

## Setup

### 1. Backend

```bash
cd backend
uv sync
cp .env.example .env
# Edit .env and set OPENAI_API_KEY (+ optional OPENAI_BASE_URL, OPENAI_MODEL)
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:5173
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | Your API key |
| `OPENAI_BASE_URL` | No | OpenAI default | Override for Ollama, Azure, Together, etc. |
| `OPENAI_MODEL` | No | `gpt-4o` | Model name |

## Features

- **Chat with AI** — describe your diagram in plain English
- **Live editor** — edit Mermaid code with syntax highlighting
- **Live preview** — diagram renders in real time as you type
- **Iterative updates** — ask AI to modify the current diagram
