import os
import json
from pathlib import Path
from openai import AsyncOpenAI
from dotenv import load_dotenv

# Always load .env from the backend/ directory, regardless of cwd
load_dotenv(Path(__file__).parent.parent / ".env")

client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL"),
)

MODEL = os.getenv("OPENAI_MODEL", "gemini-2.0-flash-lite")

print(f"[ai] Using model: {MODEL}")
print(f"[ai] Base URL: {os.getenv('OPENAI_BASE_URL', 'default OpenAI')}")
print(f"[ai] API key loaded: {'yes' if os.getenv('OPENAI_API_KEY') else 'NO - check .env!'}")

# ── System prompt ────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You are an expert Mermaid diagram assistant embedded in an interactive editor.

Your job is to call one of two tools:

1. **generate_diagram** — call this when you have ENOUGH information to create a clear, \
meaningful Mermaid diagram. You do NOT need perfect information; reasonable assumptions are fine \
for common patterns (login flows, CI/CD pipelines, class hierarchies, etc.).

2. **ask_clarification** — call this ONLY when the request is genuinely too ambiguous to produce \
any useful diagram. For example:
   - "make a diagram" (no subject at all)
   - "diagram my system" (need to know what the system is)
   Ask ONE specific, focused question. Do not ask multiple questions at once.

Diagram rules:
- Use the most appropriate diagram type (flowchart, sequenceDiagram, classDiagram, \
  stateDiagram-v2, erDiagram, gantt, etc.)
- Default to `flowchart TD` when type is unspecified but subject is clear
- Use proper, valid Mermaid v11 syntax
- Keep diagrams clean and readable
- When updating an existing diagram, preserve its structure and only make the requested changes
"""

# ── Tool definitions ─────────────────────────────────────────────
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "generate_diagram",
            "description": (
                "Generate a Mermaid diagram. Call this whenever you have enough context "
                "to produce something useful — reasonable assumptions are encouraged."
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
                "Ask the user ONE focused question when the request is too vague to generate "
                "any meaningful diagram. Use sparingly — prefer generating with assumptions."
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


async def generate_mermaid(message: str, current_diagram: str | None = None) -> dict:
    """
    Agentic loop: the LLM decides whether to generate a diagram or ask for clarification.

    Returns:
        {
            "mermaid_code": str | None,
            "explanation": str,
            "needs_clarification": bool,
        }
    """
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

    if current_diagram:
        messages.append({
            "role": "user",
            "content": f"Here is the current diagram:\n\n```mermaid\n{current_diagram}\n```",
        })
        messages.append({
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "ctx_init",
                    "type": "function",
                    "function": {
                        "name": "generate_diagram",
                        "arguments": json.dumps({
                            "mermaid_code": current_diagram,
                            "explanation": "Current diagram loaded.",
                        }),
                    },
                }
            ],
        })
        messages.append({
            "role": "tool",
            "tool_call_id": "ctx_init",
            "content": "Diagram context noted. Ready for the user's request.",
        })

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
        text = choice.message.content or "I couldn't generate a diagram. Could you clarify your request?"
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
