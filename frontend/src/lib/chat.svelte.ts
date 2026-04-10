import type { Message } from "$lib/types";
import { sendWsMessage, type WsCallbacks, type WsHandle, type UserMessagePayload, type ImageUploadPayload } from "$lib/ws";

export type PreviewTab = "mermaid" | "enhanced";

function buildHistory(
  msgs: Message[],
  { skip }: { skip?: "first" | "last" | "both" } = {},
): { role: string; content: string }[] {
  let slice = msgs;
  if (skip === "first" || skip === "both") slice = slice.slice(1);
  if (skip === "last" || skip === "both") slice = slice.slice(0, -1);

  const filtered = slice
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  const deduped: { role: string; content: string }[] = [];
  for (const m of filtered) {
    if (deduped.length > 0 && deduped[deduped.length - 1].role === m.role) {
      deduped[deduped.length - 1] = m;
    } else {
      deduped.push(m);
    }
  }

  return deduped.slice(-20);
}

const DEFAULT_DIAGRAM = `---
config:
  look: handDrawn
---
flowchart TD
    Start([Start])
    Start --> Describe[Describe Diagram]
    Start --> Upload[Upload Image]

    Describe --> AI[[AI Agent]]
    Upload --> AI

    AI --> Code[Mermaid Code]
    Code --> Preview[Live Preview]

    %% Feedback Loops
    Code -- "iterate/feedback" --> AI`;

export function createChatStore() {
  let diagramCode = $state(DEFAULT_DIAGRAM);
  let codeSource: "ai" | "user" = $state("user");

  let messages = $state<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your Mermaid diagram assistant. Describe a diagram in detail and I'll generate it for you.",
    },
  ]);
  let isLoading = $state(false);

  let chartType: string | null = $state(null);

  // Enhancement state
  let enhancedImage: string | null = $state(null);
  let activePreviewTab: PreviewTab = $state("mermaid");

  // Status message from agent tools (e.g. "Rendering diagram…")
  let statusMessage: string | null = $state(null);

  let activeWsHandle: WsHandle | null = null;

  // Callbacks set by the page component to interact with the Preview
  let getDiagramImage: (() => Promise<string | null>) | null = null;
  let renderMermaidCode: ((code: string) => Promise<{ error?: string }>) | null = null;

  /**
   * Build WsCallbacks that wire tool requests into the Preview component.
   */
  function makeWsCallbacks(userMessage: string): WsCallbacks {
    return {
      onStatus(msg: string) {
        statusMessage = msg || null;
      },

      onMermaidCode(code: string) {
        codeSource = "ai";
        diagramCode = code;
      },

      onEnhancedImage(image: string) {
        enhancedImage = image;
        activePreviewTab = "enhanced";
      },

      onMessage(content: string, followUpCommands: string[], mermaidCode: string | null) {
        if (mermaidCode) {
          codeSource = "ai";
          diagramCode = mermaidCode;
        }
        messages.push({
          role: "assistant",
          content,
          followUpSuggestions: followUpCommands,
        });
      },

      onError(message: string) {
        messages.push({
          role: "assistant",
          content: `Error: ${message}`,
        });
      },

      onDone() {
        isLoading = false;
        statusMessage = null;
      },

      async renderAndCapture(mermaidCode: string) {
        codeSource = "ai";
        diagramCode = mermaidCode;

        if (renderMermaidCode) {
          const result = await renderMermaidCode(mermaidCode);
          if (result.error) {
            return { error: result.error };
          }
        }

        // Wait a tick for the render to propagate, then capture
        await new Promise((r) => setTimeout(r, 600));

        if (getDiagramImage) {
          const image = await getDiagramImage();
          if (image) {
            return { image };
          }
          return { error: "Failed to capture diagram image" };
        }
        return { error: "Diagram capture not available" };
      },

      async captureScreenshot() {
        if (getDiagramImage) {
          const image = await getDiagramImage();
          if (image) {
            return { image };
          }
          return { error: "Failed to capture diagram image" };
        }
        return { error: "Diagram capture not available" };
      },
    };
  }

  async function sendChatRequest(userMessage: string, contextDiagram: string | null) {
    isLoading = true;

    const history = buildHistory(messages, { skip: "both" });

    if (contextDiagram === DEFAULT_DIAGRAM) {
      contextDiagram = null;
    }

    const payload: UserMessagePayload = {
      type: "user_message",
      message: userMessage,
      current_mermaid_code: contextDiagram,
      history,
      chart_type: chartType,
    };

    const callbacks = makeWsCallbacks(userMessage);
    const handle = sendWsMessage(payload, callbacks);
    activeWsHandle = handle;

    try {
      await handle.done;
    } catch {
      // Errors are already handled by onError callback
    } finally {
      activeWsHandle = null;
    }
  }

  function handleUserSubmit(text: string) {
    messages.push({ role: "user", content: text });
    sendChatRequest(text, diagramCode);
  }

  async function handleImageUpload(file: File, userMessage: string) {
    const previewUrl = URL.createObjectURL(file);
    messages.push({
      role: "user",
      content: userMessage || "Convert this image to a Mermaid diagram",
      imageUrl: previewUrl,
    });

    isLoading = true;

    const history = buildHistory(messages, { skip: "both" });

    // Read file as base64
    const arrayBuf = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    const payload: ImageUploadPayload = {
      type: "image_upload",
      image: base64,
      mime_type: file.type || "image/png",
      message: userMessage,
      history,
    };

    const callbacks = makeWsCallbacks(userMessage);
    const handle = sendWsMessage(payload, callbacks);
    activeWsHandle = handle;

    try {
      await handle.done;
    } catch {
      // Errors handled by onError callback
    } finally {
      activeWsHandle = null;
      URL.revokeObjectURL(previewUrl);
    }
  }

  function handleCodeChange(code: string) {
    codeSource = "user";
    diagramCode = code;
  }

  function stopAgent() {
    if (activeWsHandle) {
      activeWsHandle.stop();
      activeWsHandle = null;
    }
    isLoading = false;
    statusMessage = null;
  }

  function handleFixRequest(code: string, error: string) {
    if (isLoading) return;
    const fixMsg = `Fix the rendering error in the Mermaid code.\nError: ${error}`;
    messages.push({ role: "user", content: fixMsg });
    sendChatRequest(fixMsg, code);
  }

  return {
    get diagramCode() { return diagramCode; },
    get messages() { return messages; },
    get isLoading() { return isLoading; },
    get chartType() { return chartType; },
    set chartType(v: string | null) { chartType = v; },
    get enhancedImage() { return enhancedImage; },
    get activePreviewTab() { return activePreviewTab; },
    set activePreviewTab(v: PreviewTab) { activePreviewTab = v; },
    get statusMessage() { return statusMessage; },
    set getDiagramImage(fn: (() => Promise<string | null>) | null) { getDiagramImage = fn; },
    set renderMermaidCode(fn: ((code: string) => Promise<{ error?: string }>) | null) { renderMermaidCode = fn; },
    handleUserSubmit,
    handleImageUpload,
    handleCodeChange,
    handleFixRequest,
    stopAgent,
  };
}
