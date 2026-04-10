from contextlib import asynccontextmanager
import asyncio

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.services.agent import run_unified_agent, AgentDeps
from app.services.doc_fetcher import fetch_docs
import logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: fetch docs (if needed)."""
    await fetch_docs()
    yield


app = FastAPI(title="Mermaid Agent API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════
#  WebSocket Agent Endpoint
# ══════════════════════════════════════════════════════════════════


async def _listen_for_tool_results(
    ws: WebSocket,
    deps: AgentDeps,
    stop_event: asyncio.Event,
    agent_task: asyncio.Task | None = None,
) -> None:
    """Receive messages from the frontend and resolve pending tool futures.

    Also handles 'stop' messages by cancelling the running agent task.
    """
    while not stop_event.is_set():
        try:
            msg = await asyncio.wait_for(ws.receive_json(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        except (WebSocketDisconnect, RuntimeError):
            break

        msg_type = msg.get("type")

        if msg_type == "stop":
            logger.info("Received stop request from client")
            if agent_task and not agent_task.done():
                agent_task.cancel()
            break

        if msg_type == "tool_result":
            tool_id = msg.get("id")
            if tool_id:
                result = msg.get("result", {})
                deps.resolve_tool(tool_id, result)


@app.websocket("/api/chat/ws")
async def chat_ws(ws: WebSocket):
    await ws.accept()

    try:
        data = await ws.receive_json()
        msg_type = data.get("type")

        if msg_type not in ("user_message", "image_upload"):
            await ws.send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})
            await ws.send_json({"type": "done"})
            return

        deps = AgentDeps(ws=ws)
        stop_event = asyncio.Event()

        agent_task = asyncio.create_task(run_unified_agent(deps, data))

        listener = asyncio.create_task(
            _listen_for_tool_results(ws, deps, stop_event, agent_task)
        )

        try:
            result = await agent_task

            await ws.send_json({
                "type": "message",
                "content": result.get("explanation", ""),
                "follow_up_commands": result.get("follow_up_commands", []),
                "mermaid_code": result.get("mermaid_code"),
            })
        except asyncio.CancelledError:
            logger.info("Agent task cancelled by client stop request")
            await ws.send_json({"type": "error", "message": "Stopped by user"})
        except Exception as e:
            logger.exception("WebSocket agent error")
            await ws.send_json({"type": "error", "message": str(e)})
        finally:
            stop_event.set()
            listener.cancel()
            try:
                await listener
            except asyncio.CancelledError:
                pass

        await ws.send_json({"type": "done"})

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.exception("WebSocket handler error")
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass


@app.get("/health")
async def health():
    return {"status": "ok"}
