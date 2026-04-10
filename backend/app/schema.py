from pydantic import BaseModel, Field


class ChatResponse(BaseModel):
    mermaid_code: str | None = Field(
        default=None,
        description="The raw mermaid code for the diagram. Do NOT enclose it in markdown code blocks (e.g. ```mermaid ... ```).",
    )
    explanation: str
    follow_up_commands: list[str] = Field(
        default=[],
        description="Choices to modify the diagram in the form of specific actionable commands.",
    )
