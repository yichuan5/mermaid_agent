import os
import json
import logging
import base64
import asyncio
from collections.abc import AsyncIterable
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4
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
    AgentStreamEvent,
    PartDeltaEvent,
    TextPartDelta,
)
from google.genai import types as genai_types
from fastapi import WebSocket
from .prompts import SYSTEM_PROMPT, ENHANCE_PROMPT

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

load_dotenv(Path(__file__).parent.parent.parent / ".env")

MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
API_KEY = os.getenv("GEMINI_API_KEY")

logger.info("Using model: %s", MODEL)
logger.info("API key loaded: %s", "yes" if API_KEY else "NO - check .env!")

provider = GoogleProvider(api_key=API_KEY)
llm = GoogleModel(model_name=MODEL, provider=provider)

ENHANCE_MODEL = os.getenv("GEMINI_ENHANCE_MODEL", "gemini-3.1-flash-image-preview")

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


# ── Shared helper functions ──────────────────────────────────────


def _clean_markdown(content: str) -> str:
    """Remove all lines before the first top-level heading (#)."""
    lines = content.split("\n")
    for i, line in enumerate(lines):
        if line.startswith("# "):
            return "\n".join(lines[i:])
    return content


def _resolve_schema_refs(
    schema: dict, obj: dict | list | str | int | float | bool | None, depth: int = 0
) -> any:
    """Recursively resolve $ref pointers in a JSON schema."""
    if depth > 5:
        return obj

    if isinstance(obj, dict):
        if "$ref" in obj:
            ref_path = obj["$ref"]
            if ref_path.startswith("#/$defs/"):
                def_name = ref_path.split("/")[-1]
                resolved_def = schema.get("$defs", {}).get(def_name, {})
                merged = {k: v for k, v in obj.items() if k != "$ref"}
                merged.update(resolved_def)
                return _resolve_schema_refs(schema, merged, depth + 1)
            return obj

        return {k: _resolve_schema_refs(schema, v, depth + 1) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_resolve_schema_refs(schema, item, depth + 1) for item in obj]
    else:
        return obj


def _read_mermaid_syntax_impl(diagram_type: DiagramType) -> str:
    """Core logic for reading Mermaid syntax docs."""
    logger.info("Agent requested documentation: %s", diagram_type)
    path = DOCS_DIR / f"{diagram_type}.md"
    if path.exists():
        return _clean_markdown(path.read_text(encoding="utf-8"))
    return f"Documentation for '{diagram_type}' not found. Please select a valid diagram type."


_config_schema_cache: dict | None = None


def _load_config_schema() -> dict | None:
    """Load and cache the Mermaid config schema from disk."""
    global _config_schema_cache
    if _config_schema_cache is not None:
        return _config_schema_cache

    path = DOCS_DIR.parent / "config.schema.json"
    if not path.exists():
        return None

    try:
        _config_schema_cache = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    return _config_schema_cache


def _read_mermaid_config_impl(property_name: str | None = None) -> str:
    """Core logic for reading Mermaid config schema."""
    logger.info("Agent requested Mermaid config schema (property_name=%r)", property_name)
    schema = _load_config_schema()
    if schema is None:
        return "Configuration schema not found locally."

    properties = schema.get("properties", {})

    if not property_name:
        summary = ["Top-level Mermaid configuration properties:"]
        for prop, details in properties.items():
            desc = details.get("description", "").split("\n")[0]
            if desc:
                summary.append(f"- {prop}: {desc}")
            else:
                summary.append(f"- {prop}")
        summary.append(
            "\nCall this tool again with `property_name='<prop_name>'` to get the full "
            "schema for a specific property (e.g. `property_name='flowchart'`)."
        )
        return "\n".join(summary)

    if property_name not in properties:
        return f"Property '{property_name}' not found in the root configuration schema."

    resolved_prop = _resolve_schema_refs(schema, properties[property_name])
    return json.dumps({property_name: resolved_prop}, indent=2)


def _parse_follow_ups(text: str) -> tuple[str, list[str]]:
    """Extract follow-up suggestions from the agent's text response.

    Scans backwards for lines starting with ">> " and splits them off.
    """
    lines = text.rstrip().split("\n")
    follow_ups: list[str] = []
    i = len(lines) - 1

    while i >= 0:
        line = lines[i].strip()
        if line.startswith(">> "):
            follow_ups.insert(0, line[3:].strip())
            i -= 1
        elif line == "" and follow_ups:
            i -= 1
        else:
            break

    explanation = "\n".join(lines[: i + 1]).strip()
    return explanation, follow_ups


async def _enhance_image_impl(
    image_base64: str,
    instructions: str = "",
    message: str = "",
) -> dict:
    """Call Gemini image generation to enhance a diagram. Shared by REST and WS paths."""
    prompt = ENHANCE_PROMPT + "\n\n"
    if message:
        prompt += f"Original user request: {message}\n\n"
    if instructions:
        prompt += f"Specific enhancement instructions: {instructions}\n\n"
    prompt += "Here is the rendered diagram to evaluate and potentially enhance:"

    image_bytes = base64.b64decode(image_base64)
    image_part = genai_types.Part.from_bytes(data=image_bytes, mime_type="image/png")

    logger.info(
        "enhance_image: calling Gemini (model=%s, has_instructions=%s)",
        ENHANCE_MODEL,
        bool(instructions),
    )

    try:
        client = provider.client
        response = await client.aio.models.generate_content(
            model=ENHANCE_MODEL,
            contents=[prompt, image_part],
            config=genai_types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )
    except Exception:
        logger.exception("enhance_image: Gemini call failed (model=%s)", ENHANCE_MODEL)
        raise

    enhanced_image_b64 = None
    explanation = ""

    if response.candidates:
        text_parts: list[str] = []
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                enhanced_image_b64 = base64.b64encode(part.inline_data.data).decode(
                    "utf-8"
                )
            elif part.text:
                text_parts.append(part.text)
        explanation = "\n\n".join(text_parts)

    if not explanation:
        explanation = (
            "Enhanced the diagram." if enhanced_image_b64 else "No enhancement needed."
        )

    logger.info(
        "enhance_image: done (enhanced=%s, explanation_len=%d)",
        enhanced_image_b64 is not None,
        len(explanation),
    )
    return {"enhanced_image": enhanced_image_b64, "explanation": explanation}


# ══════════════════════════════════════════════════════════════════
#  Unified WebSocket Agent
# ══════════════════════════════════════════════════════════════════


@dataclass
class AgentDeps:
    """Dependencies injected into unified agent tools at runtime."""

    ws: WebSocket
    pending_tools: dict[str, asyncio.Future] = field(default_factory=dict)

    async def request_client_tool(self, name: str, args: dict) -> dict:
        """Send a tool request to the frontend and await the result."""
        tool_id = str(uuid4())
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.pending_tools[tool_id] = future

        await self.ws.send_json(
            {"type": "tool_request", "id": tool_id, "name": name, "args": args}
        )

        try:
            return await asyncio.wait_for(future, timeout=60.0)
        finally:
            self.pending_tools.pop(tool_id, None)

    def resolve_tool(self, tool_id: str, result: dict) -> None:
        """Resolve a pending client tool request with the frontend's response."""
        future = self.pending_tools.get(tool_id)
        if future and not future.done():
            future.set_result(result)


unified_agent = Agent(
    model=llm,
    output_type=str,
    system_prompt=SYSTEM_PROMPT,
    deps_type=AgentDeps,
    retries=2,
)


@unified_agent.tool
async def read_mermaid_syntax(
    ctx: RunContext[AgentDeps], diagram_type: DiagramType
) -> str:
    """Fetch the complete Markdown documentation for a specific Mermaid diagram type."""
    await ctx.deps.ws.send_json(
        {"type": "status", "message": f"Looking up {diagram_type} syntax docs…"}
    )
    return _read_mermaid_syntax_impl(diagram_type)


@unified_agent.tool
async def read_mermaid_config(
    ctx: RunContext[AgentDeps], property_name: str | None = None
) -> str:
    """Fetch the Mermaid configuration schema. If property_name is None, returns a summary of all top-level properties. If property_name is provided, returns the detailed, fully-resolved schema for that specific property."""
    label = f"Reading config for '{property_name}'…" if property_name else "Reading config schema…"
    await ctx.deps.ws.send_json({"type": "status", "message": label})
    return _read_mermaid_config_impl(property_name)


@unified_agent.tool
async def create_mermaid_diagram(
    ctx: RunContext[AgentDeps], mermaid_code: str
) -> str:
    """Create or modify a Mermaid diagram. Pass the complete Mermaid code.

    The code is rendered in the user's browser. Returns either:
    - A success confirmation (diagram is live — do NOT call again)
    - An error message — fix the code and retry

    Only call this tool once per user request unless you get an error back.
    """
    await ctx.deps.ws.send_json(
        {"type": "status", "message": "Rendering diagram…"}
    )
    result = await ctx.deps.request_client_tool(
        "render_and_capture", {"mermaid_code": mermaid_code}
    )
    if "error" in result:
        return f"Render error: {result['error']}"
    return "Diagram rendered successfully and is now visible to the user."


@unified_agent.tool
async def enhance_diagram(
    ctx: RunContext[AgentDeps], instructions: str
) -> str:
    """Visually enhance the currently rendered diagram using AI image generation.

    Mermaid's auto-layout often produces overlapping nodes, cramped labels, poor
    spacing, or awkward aspect ratios. These are inherent layout limitations that
    code changes cannot reliably fix. Call this tool to clean up such issues, or
    whenever the user asks to improve the diagram's appearance or readability.
    Captures the current diagram, enhances it, and sends the result to the user.
    """
    await ctx.deps.ws.send_json(
        {"type": "status", "message": "Enhancing diagram with AI…"}
    )
    capture = await ctx.deps.request_client_tool("capture_screenshot", {})
    if "error" in capture:
        return "Cannot enhance: diagram has rendering errors. Fix the code first."

    image_b64 = capture.get("image")
    if not image_b64:
        return "Cannot enhance: no diagram image available."

    result = await _enhance_image_impl(image_b64, instructions=instructions)

    if result.get("enhanced_image"):
        await ctx.deps.ws.send_json(
            {"type": "enhanced_image", "image": result["enhanced_image"]}
        )
        return result.get("explanation", "Enhanced the diagram successfully.")

    return result.get("explanation", "No enhancement was needed.")


async def _stream_text_handler(
    ctx: RunContext[AgentDeps],
    events: AsyncIterable[AgentStreamEvent],
) -> None:
    """event_stream_handler: forward text deltas to the frontend over WebSocket."""
    async for event in events:
        if isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
            await ctx.deps.ws.send_json(
                {"type": "text_delta", "content": event.delta.content_delta}
            )


async def run_unified_agent(deps: AgentDeps, data: dict) -> dict:
    """Run the unified agent for a single conversation turn over WebSocket."""
    msg_type = data.get("type", "user_message")

    messages: list[ModelMessage] = []
    for h in data.get("history", []):
        if h.get("role") == "user":
            messages.append(ModelRequest(parts=[UserPromptPart(content=h["content"])]))
        else:
            messages.append(ModelResponse(parts=[TextPart(content=h["content"])]))

    if msg_type == "image_upload":
        image_b64 = data["image"]
        mime_type = data.get("mime_type", "image/png")
        user_message = (
            data.get("message", "").strip()
            or "Please reproduce this image as a Mermaid diagram."
        )
        image_url = f"data:{mime_type};base64,{image_b64}"
        prompt_parts = [user_message, BinaryContent.from_data_uri(image_url)]
    else:
        user_message = data.get("message", "")
        chart_type = data.get("chart_type")
        current_mermaid_code = data.get("current_mermaid_code")

        user_prompt = ""
        if chart_type:
            user_prompt += f"Use the following diagram type: {chart_type}\n\n"
        if current_mermaid_code:
            user_prompt += (
                f"Here is the current diagram code:\n\n"
                f"```mermaid\n{current_mermaid_code}\n```\n\n"
            )
        user_prompt += f"User Request: {user_message}"
        prompt_parts = [user_prompt]

    await deps.ws.send_json({"type": "status", "message": "Thinking..."})

    logger.info(
        "run_unified_agent: type=%s, history_len=%d", msg_type, len(messages)
    )
    try:
        result = await unified_agent.run(
            user_prompt=prompt_parts,
            message_history=messages,
            deps=deps,
            event_stream_handler=_stream_text_handler,
        )
    except Exception:
        logger.exception("run_unified_agent: agent failed")
        raise

    full_text = result.output
    explanation, follow_ups = _parse_follow_ups(full_text)

    return {"explanation": explanation, "follow_up_commands": follow_ups}
