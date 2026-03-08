from pydantic import BaseModel


class HistoryMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    current_diagram: str | None = None
    current_diagram_image: str | None = None
    history: list[HistoryMessage] = []


class ChatResponse(BaseModel):
    mermaid_code: str | None = None
    explanation: str
    follow_up_suggestions: list[str] = []
