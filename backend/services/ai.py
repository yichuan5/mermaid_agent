import os
import json
import logging
from pathlib import Path
from openai import AsyncOpenAI
from dotenv import load_dotenv
from services.rag import rag

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

# Always load .env from the backend/ directory, regardless of cwd
load_dotenv(Path(__file__).parent.parent / ".env")

client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL"),
)

MODEL = os.getenv("OPENAI_MODEL", "gemini-3-flash-preview")

print(f"[ai] Using model: {MODEL}")
print(f"[ai] Base URL: {os.getenv('OPENAI_BASE_URL', 'default OpenAI')}")
print(
    f"[ai] API key loaded: {'yes' if os.getenv('OPENAI_API_KEY') else 'NO - check .env!'}"
)

# ── System prompt ────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You are an expert Mermaid diagram assistant embedded in an interactive editor.
You must always respond by calling one of the available tools.

Diagram rules:
- Use the most appropriate diagram type (flowchart, sequenceDiagram, classDiagram, \
  stateDiagram-v2, erDiagram, gantt, etc.). Default to `flowchart TD`.
- Use proper, valid Mermaid v11 syntax.
- Keep diagrams clean and readable.
- When updating an existing diagram, preserve its structure and only make the requested changes.
"""

# ── Tool definitions ─────────────────────────────────────────────
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "generate_diagram",
            "description": (
                "Generate a Mermaid diagram. Call this whenever you have enough context "
                "to produce something useful. Reasonable assumptions are encouraged — "
                "you do NOT need perfect information. Prefer this over ask_clarification."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "mermaid_code": {
                        "type": "string",
                        "description": "Complete, valid Mermaid diagram code (no markdown fences)",
                    },
                    "explanation": {
                        "type": "string",
                        "description": "1-3 sentence summary of what the diagram shows",
                    },
                },
                "required": ["mermaid_code", "explanation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_clarification",
            "description": (
                "Ask the user ONE focused question when the request is genuinely too ambiguous "
                "to produce any useful diagram (e.g. 'diagram my system' with no other context). "
                "Use sparingly — prefer generate_diagram with reasonable assumptions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "A single, specific question to get the missing information",
                    },
                },
                "required": ["question"],
            },
        },
    },
]


async def generate_mermaid(
    message: str,
    current_diagram: str | None = None,
    history: list[dict] | None = None,
) -> dict:
    """
    Agentic loop: the LLM decides whether to generate a diagram or ask for clarification.

    Returns:
        {
            "mermaid_code": str | None,
            "explanation": str,
            "needs_clarification": bool,
        }
    """
    # Retrieve relevant documentation for this query
    retrieved = rag.retrieve(message)
    doc_context = rag.format_context(retrieved)

    # Log retrieved context
    if retrieved:
        logger.info("Retrieved %d chunks for query: %r", len(retrieved), message)
        for chunk in retrieved:
            logger.info("  ↳ [%s] %s", chunk.source, chunk.heading)
    else:
        logger.info("No RAG context retrieved for query: %r", message)

    # Build system prompt with injected documentation
    if doc_context:
        full_prompt = f"{SYSTEM_PROMPT}\n\n{doc_context}"
    else:
        full_prompt = SYSTEM_PROMPT

    messages: list[dict] = [{"role": "system", "content": full_prompt}]

    if current_diagram:
        messages.append(
            {
                "role": "user",
                "content": f"Here is the current diagram:\n\n```mermaid\n{current_diagram}\n```",
            }
        )
        messages.append(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "ctx_init",
                        "type": "function",
                        "function": {
                            "name": "generate_diagram",
                            "arguments": json.dumps(
                                {
                                    "mermaid_code": current_diagram,
                                    "explanation": "Current diagram loaded.",
                                }
                            ),
                        },
                    }
                ],
            }
        )
        messages.append(
            {
                "role": "tool",
                "tool_call_id": "ctx_init",
                "content": "Diagram context noted. Ready for the user's request.",
            }
        )

    # Inject conversation history (user + assistant messages only)
    if history:
        for h in history:
            if h.get("role") in ("user", "assistant"):
                messages.append({"role": h["role"], "content": h["content"]})

    messages.append({"role": "user", "content": message})

    response = await client.chat.completions.create(
        model=MODEL,
        messages=messages,
        tools=TOOLS,
        tool_choice="required",  # force a tool call every time
        temperature=0.3,
    )

    choice = response.choices[0]
    tool_calls = getattr(choice.message, "tool_calls", None)

    if not tool_calls:
        # Fallback: model returned plain text instead of a tool call
        text = (
            choice.message.content
            or "I couldn't generate a diagram. Could you clarify your request?"
        )
        return {"mermaid_code": None, "explanation": text, "needs_clarification": True}

    call = tool_calls[0]
    fn_name = call.function.name
    try:
        args = json.loads(call.function.arguments)
    except json.JSONDecodeError:
        args = {}

    if fn_name == "generate_diagram":
        return {
            "mermaid_code": args.get("mermaid_code", ""),
            "explanation": args.get("explanation", "Here is your diagram."),
            "needs_clarification": False,
        }
    else:  # ask_clarification
        return {
            "mermaid_code": None,
            "explanation": args.get("question", "Could you provide more details?"),
            "needs_clarification": True,
        }


IMAGE_TO_MERMAID_PROMPT = """\
You are an expert at converting visual diagrams, flowcharts, architecture diagrams, \
and other visual representations into valid Mermaid v11 code.

The user has uploaded an image. Analyze it carefully and reproduce it as a Mermaid diagram.

Instructions:
- Identify the type of diagram (flowchart, sequence diagram, class diagram, ER diagram, \
  state diagram, gantt chart, etc.) and use the appropriate Mermaid syntax.
- Reproduce the structure, relationships, labels, and flow direction as faithfully as possible.
- If text in the image is hard to read, make your best guess based on context.
- Use clean, readable Mermaid syntax with proper node IDs.
- Prefer handDrawn look and neutral theme.
- If the image is NOT a diagram (e.g. a photo, screenshot of unrelated content), \
  still try to create a meaningful diagram that describes what you see.

You MUST call the generate_diagram tool with your result.
"""


async def image_to_mermaid(
    image_base64: str,
    mime_type: str = "image/png",
    user_message: str = "",
) -> dict:
    """
    Accept a base64-encoded image and ask the vision model to reproduce
    it as a Mermaid diagram.

    Returns the same shape as generate_mermaid():
        {
            "mermaid_code": str | None,
            "explanation": str,
            "needs_clarification": bool,
        }
    """
    # Build the user content with the image
    image_url = f"data:{mime_type};base64,{image_base64}"

    user_content: list[dict] = [
        {
            "type": "image_url",
            "image_url": {"url": image_url},
        },
    ]

    if user_message.strip():
        user_content.append({"type": "text", "text": user_message})
    else:
        user_content.append({
            "type": "text",
            "text": "Please reproduce this image as a Mermaid diagram.",
        })

    # Retrieve RAG context using the user message or a generic query
    rag_query = user_message.strip() if user_message.strip() else "diagram flowchart"
    retrieved = rag.retrieve(rag_query)
    doc_context = rag.format_context(retrieved)

    system_prompt = IMAGE_TO_MERMAID_PROMPT
    if doc_context:
        system_prompt = f"{IMAGE_TO_MERMAID_PROMPT}\n\n{doc_context}"

    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    logger.info("Image-to-mermaid request (mime=%s, msg=%r)", mime_type, user_message)

    response = await client.chat.completions.create(
        model=MODEL,
        messages=messages,
        tools=TOOLS,
        tool_choice="required",
        temperature=0.3,
    )

    choice = response.choices[0]
    tool_calls = getattr(choice.message, "tool_calls", None)

    if not tool_calls:
        text = (
            choice.message.content
            or "I couldn't interpret the image. Could you try a clearer one?"
        )
        return {"mermaid_code": None, "explanation": text, "needs_clarification": True}

    call = tool_calls[0]
    fn_name = call.function.name
    try:
        args = json.loads(call.function.arguments)
    except json.JSONDecodeError:
        args = {}

    if fn_name == "generate_diagram":
        return {
            "mermaid_code": args.get("mermaid_code", ""),
            "explanation": args.get("explanation", "Here is the reproduced diagram."),
            "needs_clarification": False,
        }
    else:
        return {
            "mermaid_code": None,
            "explanation": args.get("question", "Could you provide more details?"),
            "needs_clarification": True,
        }
