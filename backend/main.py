from contextlib import asynccontextmanager
import base64

from fastapi import FastAPI, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware

from services.ai import generate_mermaid, image_to_mermaid
from services.doc_fetcher import fetch_docs
from schema import ChatRequest, ChatResponse
import traceback


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: fetch docs (if needed)."""
    await fetch_docs()
    yield


app = FastAPI(title="Mermaid Agent API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    try:
        result = await generate_mermaid(
            message=req.message,
            current_diagram=req.current_diagram,
            current_diagram_image=req.current_diagram_image,
            history=req.history,
        )
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


MAX_IMAGE_SIZE = 1 * 1024 * 1024  # 1 MB


@app.post("/api/chat/image", response_model=ChatResponse)
async def chat_image(
    image: UploadFile = File(...),
    message: str = Form(""),
):
    """Accept an image upload and convert it to a Mermaid diagram."""
    # Validate file type
    allowed_types = {"image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"}
    if image.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {image.content_type}. Use PNG, JPEG, WebP, HEIC, or HEIF.",
        )

    try:
        image_bytes = await image.read()
        if len(image_bytes) > MAX_IMAGE_SIZE:
            raise HTTPException(
                status_code=400,
                detail="Image too large. Maximum size is 1 MB.",
            )

        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        result = await image_to_mermaid(
            image_base64=image_b64,
            mime_type=image.content_type or "image/png",
            user_message=message,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok"}

