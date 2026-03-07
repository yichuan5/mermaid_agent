from contextlib import asynccontextmanager
import base64

from fastapi import FastAPI, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from services.ai import generate_mermaid, image_to_mermaid
from services.doc_fetcher import fetch_docs
from services.rag import rag
import traceback


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: fetch docs (if needed) and build search index."""
    await fetch_docs()
    rag.build_index()
    yield


app = FastAPI(title="Mermaid Agent API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HistoryMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    current_diagram: str | None = None
    history: list[HistoryMessage] = []


class ChatResponse(BaseModel):
    mermaid_code: str | None = None
    explanation: str
    needs_clarification: bool = False


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    try:
        history = [{"role": h.role, "content": h.content} for h in req.history]
        result = await generate_mermaid(req.message, req.current_diagram, history)
        return ChatResponse(**result)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB


@app.post("/api/chat/image", response_model=ChatResponse)
async def chat_image(
    image: UploadFile = File(...),
    message: str = Form(""),
):
    """Accept an image upload and convert it to a Mermaid diagram."""
    # Validate file type
    allowed_types = {"image/png", "image/jpeg", "image/webp", "image/gif"}
    if image.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {image.content_type}. Use PNG, JPEG, WebP, or GIF.",
        )

    try:
        image_bytes = await image.read()
        if len(image_bytes) > MAX_IMAGE_SIZE:
            raise HTTPException(
                status_code=400,
                detail="Image too large. Maximum size is 10 MB.",
            )

        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        result = await image_to_mermaid(
            image_base64=image_b64,
            mime_type=image.content_type or "image/png",
            user_message=message,
        )
        return ChatResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok"}

