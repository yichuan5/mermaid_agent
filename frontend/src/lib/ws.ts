/**
 * WebSocket client for the unified agent protocol.
 *
 * Opens a connection per conversation turn, sends the user message,
 * dispatches server events, and executes client-side tool requests
 * (render_and_capture, capture_screenshot) via registered callbacks.
 *
 * In dev, Vite proxy forwards /api/chat/ws to the backend.
 * In production, nginx routes /api/chat/ws directly to the backend
 * with WebSocket upgrade headers.
 */

export interface WsCallbacks {
    onStatus: (message: string) => void;
    onMermaidCode: (code: string) => void;
    onEnhancedImage: (image: string) => void;
    onMessage: (content: string, followUpCommands: string[], mermaidCode: string | null) => void;
    onError: (message: string) => void;
    onDone: () => void;
    /** Render mermaid code in the browser, return screenshot or error. */
    renderAndCapture: (mermaidCode: string) => Promise<{ image?: string; error?: string }>;
    /** Capture the currently displayed diagram as a screenshot. */
    captureScreenshot: () => Promise<{ image?: string; error?: string }>;
}

export interface UserMessagePayload {
    type: "user_message";
    message: string;
    current_mermaid_code: string | null;
    history: { role: string; content: string }[];
    chart_type?: string | null;
}

export interface ImageUploadPayload {
    type: "image_upload";
    image: string;
    mime_type: string;
    message: string;
    history: { role: string; content: string }[];
}

type Payload = UserMessagePayload | ImageUploadPayload;

function getWsUrl(): string {
    const loc = window.location;
    const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${loc.host}/api/chat/ws`;
}

export interface WsHandle {
    /** Send a stop signal and close the WebSocket connection. */
    stop: () => void;
    /** Promise that resolves when the connection is done. */
    done: Promise<void>;
}

export function sendWsMessage(
    payload: Payload,
    callbacks: WsCallbacks,
): WsHandle {
    let ws: WebSocket;
    let stopped = false;

    const done = new Promise<void>((resolve, reject) => {
        try {
            ws = new WebSocket(getWsUrl());
        } catch (e: any) {
            callbacks.onError(`WebSocket connection failed: ${e.message}`);
            callbacks.onDone();
            reject(e);
            return;
        }

        let resolved = false;
        let doneReceived = false;

        function finish() {
            if (!resolved) {
                resolved = true;
                resolve();
            }
        }

        ws.onopen = () => {
            ws.send(JSON.stringify(payload));
        };

        ws.onmessage = async (event) => {
            let msg: any;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }

            switch (msg.type) {
                case "status":
                    callbacks.onStatus(msg.message ?? "");
                    break;

                case "tool_request":
                    await handleToolRequest(ws, msg, callbacks);
                    break;

                case "enhanced_image":
                    callbacks.onEnhancedImage(msg.image);
                    break;

                case "message":
                    callbacks.onMessage(
                        msg.content ?? "",
                        msg.follow_up_commands ?? [],
                        msg.mermaid_code ?? null,
                    );
                    break;

                case "error":
                    callbacks.onError(msg.message ?? "Unknown error");
                    break;

                case "done":
                    doneReceived = true;
                    callbacks.onDone();
                    ws.close();
                    finish();
                    break;
            }
        };

        ws.onerror = () => {
            if (!doneReceived) {
                callbacks.onError("WebSocket connection error");
                callbacks.onDone();
            }
            finish();
        };

        ws.onclose = () => {
            if (!doneReceived) {
                callbacks.onDone();
            }
            finish();
        };
    });

    return {
        stop() {
            if (stopped) return;
            stopped = true;
            try {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "stop" }));
                    ws.close();
                }
            } catch {
                // Connection already closed
            }
        },
        done,
    };
}

async function handleToolRequest(
    ws: WebSocket,
    msg: { id: string; name: string; args: any },
    callbacks: WsCallbacks,
): Promise<void> {
    let result: { image?: string; error?: string };

    try {
        switch (msg.name) {
            case "render_and_capture":
                result = await callbacks.renderAndCapture(msg.args.mermaid_code);
                break;
            case "capture_screenshot":
                result = await callbacks.captureScreenshot();
                break;
            default:
                result = { error: `Unknown client tool: ${msg.name}` };
        }
    } catch (e: any) {
        result = { error: e.message ?? "Client tool execution failed" };
    }

    ws.send(
        JSON.stringify({
            type: "tool_result",
            id: msg.id,
            result,
        }),
    );
}
