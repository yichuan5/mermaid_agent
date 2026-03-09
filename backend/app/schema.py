from pydantic import BaseModel, Field


class HistoryMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    current_diagram: str | None = None
    current_diagram_image: str | None = None
    history: list[HistoryMessage] = []


class ChatResponse(BaseModel):
    mermaid_code: str | None = Field(
        default=None,
        description="The raw mermaid code for the diagram. Do NOT enclose it in markdown code blocks (e.g. ```mermaid ... ```).",
    )
    explanation: str
    follow_up_commands: list[str] = Field(
        default=[],
        description="Choices to modify the diagram in the form of specific actionable commands."
    )
