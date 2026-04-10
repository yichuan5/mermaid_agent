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
    "follow_up_commands": ["Add more nodes?"],
}


# ── POST /api/chat ──────────────────────────────────────────────


class TestChatEndpoint:
    @patch("app.main.generate_mermaid", new_callable=AsyncMock, return_value=MOCK_LLM)
    def test_valid_request_returns_200(self, mock_ai, client):
        resp = client.post(
            "/api/chat",
            json={
                "message": "Draw a flowchart",
                "current_mermaid_code": None,
                "history": [],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["mermaid_code"] == MOCK_LLM["mermaid_code"]
        assert data["explanation"] == MOCK_LLM["explanation"]
        assert data["follow_up_commands"] == ["Add more nodes?"]

    @patch("app.main.generate_mermaid", new_callable=AsyncMock, return_value=MOCK_LLM)
    def test_with_history(self, mock_ai, client):
        resp = client.post(
            "/api/chat",
            json={
                "message": "Add a node",
                "current_mermaid_code": "flowchart TD\n    A --> B",
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
                "current_mermaid_code": None,
                "history": [],
            },
        )
        assert resp.status_code == 400

    def test_missing_message_field_returns_422(self, client):
        resp = client.post("/api/chat", json={})
        assert resp.status_code == 422  # Pydantic validation error


# ── POST /api/chat/image ────────────────────────────────────────


class TestImageEndpoint:
    @patch("app.main.image_to_mermaid", new_callable=AsyncMock, return_value=MOCK_LLM)
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

    @patch("app.main.image_to_mermaid", new_callable=AsyncMock, return_value=MOCK_LLM)
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


# ── POST /api/fix ────────────────────────────────────────────────


class TestFixEndpoint:
    @patch("app.main.generate_fix", new_callable=AsyncMock, return_value=MOCK_LLM)
    def test_valid_fix_request_returns_200(self, mock_ai, client):
        resp = client.post(
            "/api/fix",
            json={
                "broken_code": "flowchart TD\n    A --> B -->",
                "error": "Parse error on line 2",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["mermaid_code"] == MOCK_LLM["mermaid_code"]

    @patch("app.main.generate_fix", new_callable=AsyncMock, return_value=MOCK_LLM)
    def test_fix_with_history(self, mock_ai, client):
        resp = client.post(
            "/api/fix",
            json={
                "broken_code": "flowchart TD\n    A --> B -->",
                "error": "Parse error on line 2",
                "history": [
                    {"role": "user", "content": "Draw a flowchart"},
                    {"role": "assistant", "content": "Here you go."},
                ],
            },
        )
        assert resp.status_code == 200
        call_args = mock_ai.call_args
        assert len(call_args.kwargs["history"]) == 2

    def test_missing_broken_code_returns_422(self, client):
        resp = client.post("/api/fix", json={"error": "Parse error"})
        assert resp.status_code == 422

    def test_missing_error_returns_422(self, client):
        resp = client.post("/api/fix", json={"broken_code": "flowchart TD"})
        assert resp.status_code == 422


# ── POST /api/enhance ─────────────────────────────────────────────

MOCK_ENHANCE = {
    "enhanced_image": "iVBORw0KGgoAAAANSUhEUg==",
    "explanation": "Improved the layout.",
}

MOCK_ENHANCE_SKIP = {
    "enhanced_image": None,
    "explanation": "Diagram looks good, no enhancement needed.",
}


class TestEnhanceEndpoint:
    @patch("app.main.enhance_image", new_callable=AsyncMock, return_value=MOCK_ENHANCE)
    def test_valid_enhance_returns_200(self, mock_ai, client):
        resp = client.post(
            "/api/enhance",
            json={
                "image": "iVBORw0KGgoAAAANSUhEUg==",
                "message": "Make the layout cleaner",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["enhanced_image"] is not None
        assert data["explanation"] == "Improved the layout."

    @patch("app.main.enhance_image", new_callable=AsyncMock, return_value=MOCK_ENHANCE_SKIP)
    def test_enhance_returns_null_when_no_enhancement_needed(self, mock_ai, client):
        resp = client.post(
            "/api/enhance",
            json={
                "image": "iVBORw0KGgoAAAANSUhEUg==",
                "message": "Draw a flowchart",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["enhanced_image"] is None
        assert "no enhancement" in data["explanation"].lower()

    @patch("app.main.enhance_image", new_callable=AsyncMock, return_value=MOCK_ENHANCE)
    def test_enhance_with_custom_instructions(self, mock_ai, client):
        resp = client.post(
            "/api/enhance",
            json={
                "image": "iVBORw0KGgoAAAANSUhEUg==",
                "message": "",
                "instructions": "Fix overlapping nodes",
            },
        )
        assert resp.status_code == 200
        call_args = mock_ai.call_args
        assert call_args.kwargs["instructions"] == "Fix overlapping nodes"

    @patch("app.main.enhance_image", new_callable=AsyncMock, side_effect=Exception("LLM error"))
    def test_enhance_internal_error_returns_500(self, mock_ai, client):
        resp = client.post(
            "/api/enhance",
            json={"image": "iVBORw0KGgoAAAANSUhEUg=="},
        )
        assert resp.status_code == 500

    def test_enhance_missing_image_returns_422(self, client):
        resp = client.post("/api/enhance", json={"message": "enhance"})
        assert resp.status_code == 422


# ── POST /api/chat with mode and chart_type ──────────────────────


class TestChatModeAndChartType:
    @patch("app.main.generate_mermaid", new_callable=AsyncMock, return_value=MOCK_LLM)
    def test_chat_with_mode_and_chart_type(self, mock_ai, client):
        resp = client.post(
            "/api/chat",
            json={
                "message": "Draw a sequence diagram",
                "mode": "generate",
                "chart_type": "sequenceDiagram",
            },
        )
        assert resp.status_code == 200
        call_args = mock_ai.call_args
        assert call_args.kwargs["chart_type"] == "sequenceDiagram"

    @patch("app.main.generate_mermaid", new_callable=AsyncMock, return_value=MOCK_LLM)
    def test_chat_defaults_to_auto_mode(self, mock_ai, client):
        resp = client.post(
            "/api/chat",
            json={"message": "Draw something"},
        )
        assert resp.status_code == 200

    def test_chat_invalid_mode_returns_422(self, client):
        resp = client.post(
            "/api/chat",
            json={"message": "Draw", "mode": "invalid_mode"},
        )
        assert resp.status_code == 422

    @patch("app.main.generate_mermaid", new_callable=AsyncMock, return_value=MOCK_LLM)
    def test_chat_null_chart_type_passed_through(self, mock_ai, client):
        resp = client.post(
            "/api/chat",
            json={"message": "Draw", "chart_type": None},
        )
        assert resp.status_code == 200
        call_args = mock_ai.call_args
        assert call_args.kwargs["chart_type"] is None


# ── GET /health ─────────────────────────────────────────────────


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
