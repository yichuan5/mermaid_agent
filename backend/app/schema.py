from pydantic import BaseModel, Field


class HistoryMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(max_length=10000)
    current_mermaid_code: str | None = Field(default=None, max_length=50000)
    current_image: str | None = None
    history: list[HistoryMessage] = Field(default=[], max_length=100)
    mode: str = Field(default="auto", pattern="^(auto|generate|enhance)$")
    chart_type: str | None = Field(default=None, max_length=100)


class FixAttempt(BaseModel):
    code: str = Field(max_length=50000, description="The previous, failed Mermaid code")
    error: str = Field(max_length=5000, description="The error message that resulted from the code")


class FixRequest(BaseModel):
    broken_code: str = Field(max_length=50000)
    error: str = Field(max_length=5000)
    history: list[HistoryMessage] = Field(default=[], max_length=100)
    fix_attempts: list[FixAttempt] = Field(default=[], max_length=10, description="Previous failed attempts to fix this diagram")


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
    enhance_instructions: str | None = Field(
        default=None,
        description="If the user's request is about visual layout, spacing, or appearance improvements that cannot be solved by changing the Mermaid code, set this to specific instructions for the image enhancement agent. When set without mermaid_code, the code will not be changed and only visual enhancement will run.",
    )


class FixResponse(BaseModel):
    mermaid_code: str = Field(
        description="The corrected raw mermaid code. Do NOT enclose it in markdown code blocks (e.g. ```mermaid ... ```).",
    )


class EnhanceRequest(BaseModel):
    image: str = Field(description="Base64-encoded PNG of the rendered mermaid diagram")
    message: str = Field(default="", max_length=10000, description="The original user message for context")
    instructions: str | None = Field(default=None, max_length=10000, description="Optional custom enhancement instructions")


class EnhanceResponse(BaseModel):
    enhanced_image: str | None = Field(
        default=None,
        description="Base64-encoded PNG of the enhanced image, or null if no enhancement needed",
    )
    explanation: str = Field(default="", description="Brief explanation of what was done or why enhancement was skipped")
