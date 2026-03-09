# Mermaid Agent

An AI-powered Mermaid diagram tool. Describe a diagram in natural language and get live-rendered Mermaid code you can edit interactively.

## Features

- **Chat with AI** — describe your diagram in plain English.
- **Agentic Generation** — AI automatically fetches Mermaid syntax docs to ensure correct output.
- **Image to Mermaid** — upload an image to be translated into Mermaid code.
- **Live editor and preview** — edit Mermaid code and diagram renders in real time.
- **Agentic Updates** — AI automatically detects errors and fixes them, or refines the diagram based on your feedback.

## Stack

- **Backend**: Python / FastAPI + Pydantic AI (Gemini)
- **Frontend**: SvelteKit + CodeMirror 6 (`codemirror-lang-mermaid`) + Mermaid.js

## Setup

### 1. Backend

```bash
cd backend
uv sync
cp .env.example .env
# Edit .env and set GEMINI_API_KEY (to your Google Gemini API Key)
uvicorn app.main:app --reload --port 8000
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
| `GEMINI_API_KEY` | Yes | — | Your Gemini API key (used for the Google Provider) |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | The Gemini model name to use |

