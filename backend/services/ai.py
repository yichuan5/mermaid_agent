import os
import logging
from pathlib import Path
from dotenv import load_dotenv
from typing import Literal

from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.messages import ModelMessage, ModelRequest, UserPromptPart, ImageUrl
from schema import ChatResponse, HistoryMessage
from .prompts import SYSTEM_PROMPT, IMAGE_TO_MERMAID_PROMPT

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

# Always load .env from the backend/ directory, regardless of cwd
load_dotenv(Path(__file__).parent.parent / ".env")

MODEL = os.getenv("OPENAI_MODEL", "gemini-3-flash-preview")
BASE_URL = os.getenv("OPENAI_BASE_URL")
API_KEY = os.getenv("OPENAI_API_KEY")

print(f"[ai] Using model: {MODEL}")
print(f"[ai] Base URL: {BASE_URL or 'default OpenAI'}")
print(f"[ai] API key loaded: {'yes' if API_KEY else 'NO - check .env!'}")

# Configure the LLM using Pydantic AI's OpenAIProvider
provider = OpenAIProvider(
    base_url=BASE_URL,
    api_key=API_KEY,
)

llm = OpenAIModel(
    model_name=MODEL,
    provider=provider,
)

DOCS_DIR = Path(__file__).parent.parent / "docs" / "mermaid" / "syntax"

DiagramType = Literal[
    "architecture", "block", "c4", "classDiagram", "entityRelationshipDiagram",
    "examples", "flowchart", "gantt", "gitgraph", "kanban", "mindmap",
    "packet", "pie", "quadrantChart", "radar", "requirementDiagram",
    "sankey", "sequenceDiagram", "stateDiagram", "timeline", "treemap",
    "userJourney", "xyChart", "zenuml"
]

mermaid_agent = Agent(
    model=llm,
    output_type=ChatResponse,
    system_prompt=SYSTEM_PROMPT,
    retries=2,
)

def _clean_markdown(content: str) -> str:
    """Remove all lines before the first top-level heading (#)."""
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if line.startswith('# '):
            return '\n'.join(lines[i:])
    return content

@mermaid_agent.tool
def read_mermaid_syntax(ctx: RunContext[None], diagram_type: DiagramType) -> str:
    """Fetch the complete Markdown documentation for a specific Mermaid diagram type."""
    logger.info("Agent requested documentation: %s", diagram_type)
    
    path = DOCS_DIR / f"{diagram_type}.md"
    if path.exists():
        return _clean_markdown(path.read_text(encoding="utf-8"))
    
    return f"Documentation for '{diagram_type}' not found. Please select a valid diagram type."

async def generate_mermaid(
    message: str,
    current_diagram: str | None = None,
    current_diagram_image: str | None = None,
    history: list[HistoryMessage] | None = None,
) -> dict:
    """
    Agentic loop: the LLM can fetch documentation and then generate a diagram.
    """
    messages: list[ModelMessage] = []

    # Reconstruct history for Pydantic AI
    if history:
        for h in history:
            messages.append(
                ModelRequest(parts=[UserPromptPart(content=h.content)]) if h.role == "user" 
                else ModelRequest(parts=[UserPromptPart(content=h.content)]) # Simplification, normally we'd parse tool calls if we stored them
            )

    user_prompt = ""
    if current_diagram:
        user_prompt += f"Here is the current diagram:\n\n```mermaid\n{current_diagram}\n```\n\n"
    
    user_prompt += f"User Request: {message}"
    
    prompt_parts = [user_prompt]
    if current_diagram_image:
        image_url = f"data:image/png;base64,{current_diagram_image}"
        prompt_parts.append(ImageUrl(url=image_url))

    result = await mermaid_agent.run(
        user_prompt=prompt_parts,
        message_history=messages,
    )
    
    # The result.output is already constrained to be a ChatResponse
    return result.output.model_dump()


convert_agent = Agent(
    model=llm,
    output_type=ChatResponse,
    system_prompt=IMAGE_TO_MERMAID_PROMPT,
    retries=2,
)

# Share the same documentation fetcher tool
convert_agent.tool(read_mermaid_syntax)

async def image_to_mermaid(
    image_base64: str,
    mime_type: str = "image/png",
    user_message: str = "",
) -> dict:
    """
    Accept a base64-encoded image and ask the vision model to reproduce
    it as a Mermaid diagram using Pydantic AI.
    """
    logger.info("Image-to-mermaid request (mime=%s, msg=%r)", mime_type, user_message)

    image_url = f"data:{mime_type};base64,{image_base64}"
    
    # Construct a multimodal user prompt using Pydantic AI's structure
    prompt_parts = [
        user_message if user_message.strip() else "Please reproduce this image as a Mermaid diagram.",
        ImageUrl(url=image_url),
    ]

    result = await convert_agent.run(
        user_prompt=prompt_parts,
    )

    return result.output.model_dump()
