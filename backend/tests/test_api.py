"""Tests for the FastAPI endpoints."""

import io
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    """FastAPI test client — no real server needed."""
    return TestClient(app, raise_server_exceptions=False)


# ── Canned AI response used across tests ─────────────────────────

MOCK_LLM = {
    "mermaid_code": "flowchart TD\n    A --> B",
    "explanation": "A simple diagram.",
    "follow_up_suggestions": ["Add more nodes?"],
}


# ── POST /api/chat ──────────────────────────────────────────────

class TestChatEndpoint:
    @patch(
        "app.main.generate_mermaid", new_callable=AsyncMock, return_value=MOCK_LLM
    )
    def test_valid_request_returns_200(self, mock_ai, client):
        resp = client.post(
            "/api/chat",
            json={
                "message": "Draw a flowchart",
                "current_diagram": None,
                "history": [],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["mermaid_code"] == MOCK_LLM["mermaid_code"]
        assert data["explanation"] == MOCK_LLM["explanation"]
        assert data["follow_up_suggestions"] == ["Add more nodes?"]

    @patch(
        "app.main.generate_mermaid", new_callable=AsyncMock, return_value=MOCK_LLM
    )
    def test_with_history(self, mock_ai, client):
        resp = client.post(
            "/api/chat",
            json={
                "message": "Add a node",
                "current_diagram": "flowchart TD\n    A --> B",
                "history": [
                    {"role": "user", "content": "Draw a flowchart"},
                    {"role": "assistant", "content": "Here you go."},
                ],
            },
        )
        assert resp.status_code == 200
        # Verify the history was passed through to generate_mermaid
        call_args = mock_ai.call_args
        assert len(call_args.kwargs["history"]) == 2  # 2 history messages

    def test_empty_message_returns_400(self, client):
        resp = client.post(
            "/api/chat",
            json={
                "message": "   ",
                "current_diagram": None,
                "history": [],
            },
        )
        assert resp.status_code == 400

    def test_missing_message_field_returns_422(self, client):
        resp = client.post("/api/chat", json={})
        assert resp.status_code == 422  # Pydantic validation error


# ── POST /api/chat/image ────────────────────────────────────────


class TestImageEndpoint:
    @patch(
        "app.main.image_to_mermaid", new_callable=AsyncMock, return_value=MOCK_LLM
    )
    def test_valid_png_returns_200(self, mock_ai, client):
        # Create a minimal fake PNG (just needs a valid content type header)
        fake_png = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
        resp = client.post(
            "/api/chat/image",
            files={"image": ("test.png", fake_png, "image/png")},
            data={"message": "Convert this"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["mermaid_code"] is not None

    @patch(
        "app.main.image_to_mermaid", new_callable=AsyncMock, return_value=MOCK_LLM
    )
    def test_valid_jpeg_returns_200(self, mock_ai, client):
        fake_jpg = io.BytesIO(b"\xff\xd8\xff" + b"\x00" * 100)
        resp = client.post(
            "/api/chat/image",
            files={"image": ("test.jpg", fake_jpg, "image/jpeg")},
            data={"message": ""},
        )
        assert resp.status_code == 200

    def test_wrong_content_type_returns_400(self, client):
        fake_txt = io.BytesIO(b"not an image")
        resp = client.post(
            "/api/chat/image",
            files={"image": ("test.txt", fake_txt, "text/plain")},
            data={"message": ""},
        )
        assert resp.status_code == 400
        assert "Unsupported image type" in resp.json()["detail"]


# ── GET /health ─────────────────────────────────────────────────


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
