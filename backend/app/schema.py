from pydantic import BaseModel, Field
from typing import Literal


class ChatResponse(BaseModel):
    explanation: str = Field(
        description="A very brief summary of the steps/tools used to create the diagram and the changes made to the diagram.",
    )
    follow_up_commands: list[str] = Field(
        default=[],
        description="Choices to modify the diagram in the form of specific actionable commands.",
    )


# ── WebSocket message validation models ──────────────────────────


class WsUserMessage(BaseModel):
    type: Literal["user_message"]
    message: str
    current_mermaid_code: str | None = None
    history: list[dict] = Field(default_factory=list)
    chart_type: str | None = None
    force_enhance: bool = False


class WsImageUpload(BaseModel):
    type: Literal["image_upload"]
    image: str
    mime_type: str = "image/png"
    message: str = ""
    history: list[dict] = Field(default_factory=list)
