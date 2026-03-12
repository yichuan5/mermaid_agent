import os
import json
import logging
from pathlib import Path
from dotenv import load_dotenv
from typing import Literal

from pydantic_ai import Agent, RunContext
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    UserPromptPart,
    TextPart,
    BinaryContent,
)
from app.schema import ChatResponse, FixResponse, HistoryMessage, FixAttempt
from .prompts import SYSTEM_PROMPT, IMAGE_TO_MERMAID_PROMPT, FIX_PROMPT

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

# Always load .env from the backend/ directory, regardless of cwd
load_dotenv(Path(__file__).parent.parent.parent / ".env")

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
API_KEY = os.getenv("GEMINI_API_KEY")

logger.info("Using model: %s", MODEL)
logger.info("API key loaded: %s", "yes" if API_KEY else "NO - check .env!")

provider = GoogleProvider(api_key=API_KEY)
llm = GoogleModel(model_name=MODEL, provider=provider)

DOCS_DIR = Path(__file__).parent.parent / "docs" / "mermaid" / "syntax"

DiagramType = Literal[
    "architecture",
    "block",
    "c4",
    "classDiagram",
    "entityRelationshipDiagram",
    "examples",
    "flowchart",
    "gantt",
    "gitgraph",
    "kanban",
    "mindmap",
    "packet",
    "pie",
    "quadrantChart",
    "radar",
    "requirementDiagram",
    "sankey",
    "sequenceDiagram",
    "stateDiagram",
    "timeline",
    "treemap",
    "userJourney",
    "xyChart",
    "zenuml",
]

mermaid_agent = Agent(
    model=llm,
    output_type=ChatResponse,
    system_prompt=SYSTEM_PROMPT,
    retries=2,
)


def _clean_markdown(content: str) -> str:
    """Remove all lines before the first top-level heading (#)."""
    lines = content.split("\n")
    for i, line in enumerate(lines):
        if line.startswith("# "):
            return "\n".join(lines[i:])
    return content


@mermaid_agent.tool
def read_mermaid_syntax(ctx: RunContext[None], diagram_type: DiagramType) -> str:
    """Fetch the complete Markdown documentation for a specific Mermaid diagram type."""
    logger.info("Agent requested documentation: %s", diagram_type)

    path = DOCS_DIR / f"{diagram_type}.md"
    if path.exists():
        return _clean_markdown(path.read_text(encoding="utf-8"))

    return f"Documentation for '{diagram_type}' not found. Please select a valid diagram type."


def _resolve_schema_refs(
    schema: dict, obj: dict | list | str | int | float | bool | None, depth: int = 0
) -> any:
    """Recursively resolve $ref pointers in a JSON schema."""
    if depth > 5:  # Prevent infinite recursion just in case
        return obj

    if isinstance(obj, dict):
        if "$ref" in obj:
            ref_path = obj["$ref"]
            if ref_path.startswith("#/$defs/"):
                def_name = ref_path.split("/")[-1]
                resolved_def = schema.get("$defs", {}).get(def_name, {})
                # Merge the resolved properties with any other properties on this level
                merged = {k: v for k, v in obj.items() if k != "$ref"}
                merged.update(resolved_def)
                return _resolve_schema_refs(schema, merged, depth + 1)
            return obj  # Unsupported ref format

        return {k: _resolve_schema_refs(schema, v, depth + 1) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_resolve_schema_refs(schema, item, depth + 1) for item in obj]
    else:
        return obj


@mermaid_agent.tool
def read_mermaid_config(ctx: RunContext[None], property_name: str | None = None) -> str:
    """Fetch the Mermaid configuration schema. If property_name is None, returns a summary of all top-level properties. If property_name is provided, returns the detailed, fully-resolved schema for that specific property."""
    logger.info(
        "Agent requested Mermaid config schema (property_name=%r)", property_name
    )

    path = DOCS_DIR.parent / "config.schema.json"
    if not path.exists():
        return "Configuration schema not found locally."

    try:
        schema = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return "Failed to parse the configuration schema JSON."

    properties = schema.get("properties", {})

    if not property_name:
        # Provide a summarized list of all root properties
        summary = ["Top-level Mermaid configuration properties:"]
        for prop, details in properties.items():
            desc = details.get("description", "").split("\n")[0]
            if desc:
                summary.append(f"- {prop}: {desc}")
            else:
                summary.append(f"- {prop}")
        summary.append(
            "\nCall this tool again with `property_name='<prop_name>'` to get the full schema for a specific property (e.g. `property_name='flowchart'`)."
        )
        return "\n".join(summary)

    if property_name not in properties:
        return f"Property '{property_name}' not found in the root configuration schema."

    # Resolve any $refs so the agent doesn't get useless pointers
    resolved_prop = _resolve_schema_refs(schema, properties[property_name])

    return json.dumps({property_name: resolved_prop}, indent=2)


async def generate_mermaid(
    message: str,
    current_mermaid_code: str | None = None,
    current_image: str | None = None,
    history: list[HistoryMessage] | None = None,
) -> dict:
    """
    Agentic loop: the LLM can fetch documentation and then generate a diagram.
    """
    messages: list[ModelMessage] = []

    # Reconstruct history for Pydantic AI
    if history:
        for h in history:
            if h.role == "user":
                messages.append(ModelRequest(parts=[UserPromptPart(content=h.content)]))
            else:
                messages.append(ModelResponse(parts=[TextPart(content=h.content)]))

    user_prompt = ""
    if current_mermaid_code:
        user_prompt += f"Here is the current diagram code:\n\n```mermaid\n{current_mermaid_code}\n```\n\n"
        if current_image:
            user_prompt += "The attached image is the rendered output of this current diagram code.\n\n"

    user_prompt += f"User Request: {message}"

    prompt_parts = [user_prompt]
    if current_image:
        image_url = f"data:image/png;base64,{current_image}"
        prompt_parts.append(BinaryContent.from_data_uri(image_url))

    result = await mermaid_agent.run(
        user_prompt=prompt_parts,
        message_history=messages,
    )

    # The result.output is already constrained to be a ChatResponse
    return result.output.model_dump()


fix_agent = Agent(
    model=llm,
    output_type=FixResponse,
    system_prompt=FIX_PROMPT,
    retries=2,
)

fix_agent.tool(read_mermaid_syntax)
fix_agent.tool(read_mermaid_config)


async def generate_fix(
    broken_code: str,
    error: str,
    history: list[HistoryMessage] | None = None,
    fix_attempts: list[FixAttempt] | None = None,
) -> dict:
    """Fix a broken Mermaid diagram based on the rendering error."""
    messages: list[ModelMessage] = []

    if history:
        for h in history:
            if h.role == "user":
                messages.append(ModelRequest(parts=[UserPromptPart(content=h.content)]))
            else:
                messages.append(ModelResponse(parts=[TextPart(content=h.content)]))

    if fix_attempts:
        user_prompt = "Previous failed attempts to fix this diagram — do NOT repeat these mistakes:\n\n"
        for i, attempt in enumerate(fix_attempts, 1):
            user_prompt += (
                f"Attempt {i}:\n"
                f"Code:\n```mermaid\n{attempt.code}\n```\n"
                f"Error: {attempt.error}\n\n"
            )
        user_prompt += "Now, the current Mermaid code still fails to render:\n\n"
    else:
        user_prompt = "The following Mermaid code failed to render:\n\n"

    user_prompt += (
        f"```mermaid\n{broken_code}\n```\n\n"
        f"Error: {error}\n\n"
        f"Please fix the syntax and return corrected Mermaid code."
    )

    result = await fix_agent.run(
        user_prompt=user_prompt,
        message_history=messages,
    )

    return result.output.model_dump()


convert_agent = Agent(
    model=llm,
    output_type=ChatResponse,
    system_prompt=IMAGE_TO_MERMAID_PROMPT,
    retries=2,
)

# Share the same documentation fetcher tool
convert_agent.tool(read_mermaid_syntax)
convert_agent.tool(read_mermaid_config)


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
        user_message
        if user_message.strip()
        else "Please reproduce this image as a Mermaid diagram.",
        BinaryContent.from_data_uri(image_url),
    ]

    result = await convert_agent.run(
        user_prompt=prompt_parts,
    )

    return result.output.model_dump()
