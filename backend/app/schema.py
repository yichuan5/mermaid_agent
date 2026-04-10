from pydantic import BaseModel, Field


class ChatResponse(BaseModel):
    explanation: str = Field(
        description="A very brief summary of the steps/tools used to create the diagram and the changes made to the diagram.",
    )
    follow_up_commands: list[str] = Field(
        default=[],
        description="Choices to modify the diagram in the form of specific actionable commands.",
    )
