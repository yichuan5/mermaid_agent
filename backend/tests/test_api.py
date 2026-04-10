"""Tests for the FastAPI endpoints (WebSocket + health)."""

from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    """FastAPI test client — no real server needed."""
    return TestClient(app, raise_server_exceptions=False)


MOCK_LLM = {
    "mermaid_code": "flowchart TD\n    A --> B",
    "explanation": "A simple diagram.",
    "follow_up_commands": ["Add more nodes?"],
}


# ── WebSocket /api/chat/ws ──────────────────────────────────────


class TestWebSocket:
    @patch("app.main.run_unified_agent", new_callable=AsyncMock)
    def test_ws_user_message(self, mock_agent, client):
        mock_agent.return_value = {
            "mermaid_code": "flowchart TD\n    A --> B",
            "explanation": "Here's a flowchart.",
            "follow_up_commands": ["Add node C"],
        }

        with client.websocket_connect("/api/chat/ws") as ws:
            ws.send_json({
                "type": "user_message",
                "message": "Draw a flowchart",
                "current_mermaid_code": None,
                "history": [],
            })

            messages = []
            while True:
                msg = ws.receive_json()
                messages.append(msg)
                if msg["type"] == "done":
                    break

            types = [m["type"] for m in messages]
            assert "message" in types
            assert "done" in types

            result_msg = next(m for m in messages if m["type"] == "message")
            assert result_msg["content"] == "Here's a flowchart."
            assert result_msg["mermaid_code"] == "flowchart TD\n    A --> B"
            assert result_msg["follow_up_commands"] == ["Add node C"]

    @patch("app.main.run_unified_agent", new_callable=AsyncMock)
    def test_ws_image_upload(self, mock_agent, client):
        mock_agent.return_value = {
            "mermaid_code": "flowchart TD\n    X --> Y",
            "explanation": "Converted from image.",
            "follow_up_commands": [],
        }

        with client.websocket_connect("/api/chat/ws") as ws:
            ws.send_json({
                "type": "image_upload",
                "image": "iVBORw0KGgoAAAANSUhEUg==",
                "mime_type": "image/png",
                "message": "Convert this",
                "history": [],
            })

            messages = []
            while True:
                msg = ws.receive_json()
                messages.append(msg)
                if msg["type"] == "done":
                    break

            result_msg = next(m for m in messages if m["type"] == "message")
            assert result_msg["mermaid_code"] == "flowchart TD\n    X --> Y"

    def test_ws_unknown_type_returns_error(self, client):
        with client.websocket_connect("/api/chat/ws") as ws:
            ws.send_json({"type": "invalid_type"})

            messages = []
            while True:
                msg = ws.receive_json()
                messages.append(msg)
                if msg["type"] == "done":
                    break

            error_msg = next(m for m in messages if m["type"] == "error")
            assert "Unknown" in error_msg["message"]

    @patch("app.main.run_unified_agent", new_callable=AsyncMock, side_effect=Exception("LLM failed"))
    def test_ws_agent_error(self, mock_agent, client):
        with client.websocket_connect("/api/chat/ws") as ws:
            ws.send_json({
                "type": "user_message",
                "message": "Draw something",
                "current_mermaid_code": None,
                "history": [],
            })

            messages = []
            while True:
                msg = ws.receive_json()
                messages.append(msg)
                if msg["type"] == "done":
                    break

            types = [m["type"] for m in messages]
            assert "error" in types


# ── GET /health ─────────────────────────────────────────────────


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
