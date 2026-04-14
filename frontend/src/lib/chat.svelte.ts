import type { Message } from "$lib/types";
import { sendWsMessage, type WsCallbacks, type WsHandle, type UserMessagePayload, type ImageUploadPayload } from "$lib/ws";

export type PreviewTab = "mermaid" | "enhanced";

const STORAGE_MESSAGES = "mermaid_agent_messages";
const STORAGE_CODE = "mermaid_agent_diagram_code";

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

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "Hi! I'm your Mermaid diagram assistant. Describe a diagram in detail and I'll generate it for you.",
};

function loadFromStorage(): { messages: Message[]; code: string } | null {
  try {
    const storedMsgs = localStorage.getItem(STORAGE_MESSAGES);
    const storedCode = localStorage.getItem(STORAGE_CODE);
    if (storedMsgs) {
      const msgs = JSON.parse(storedMsgs) as Message[];
      if (Array.isArray(msgs) && msgs.length > 0) {
        return { messages: msgs, code: storedCode || DEFAULT_DIAGRAM };
      }
    }
  } catch {
    // Corrupted storage — ignore
  }
  return null;
}

function saveToStorage(messages: Message[], code: string) {
  try {
    const serializable = messages
      .filter((m) => !m.isStreaming)
      .map(({ role, content, followUpSuggestions }) => ({
        role,
        content,
        followUpSuggestions,
      }));
    localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(serializable));
    localStorage.setItem(STORAGE_CODE, code);
  } catch {
    // Storage full or unavailable — ignore
  }
}

export function createChatStore() {
  const restored = typeof window !== "undefined" ? loadFromStorage() : null;

  let diagramCode = $state(restored?.code ?? DEFAULT_DIAGRAM);
  let codeSource: "ai" | "user" = $state("user");

  let messages = $state<Message[]>(restored?.messages ?? [WELCOME_MESSAGE]);
  let isLoading = $state(false);

  let chartType: string | null = $state(null);

  let enhancedImage: string | null = $state(null);
  let activePreviewTab: PreviewTab = $state("mermaid");

  let statusMessage: string | null = $state(null);

  let activeWsHandle: WsHandle | null = null;

  let getDiagramImage: (() => Promise<string | null>) | null = null;
  let renderMermaidCode: ((code: string) => Promise<{ error?: string }>) | null = null;

  let saveTimer: ReturnType<typeof setTimeout>;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveToStorage(messages, diagramCode), 800);
  }

  /**
   * Build WsCallbacks that wire tool requests into the Preview component.
   */
  function makeWsCallbacks(userMessage: string): WsCallbacks {
    return {
      onStatus(msg: string) {
        statusMessage = msg || null;
      },

      onTextDelta(content: string) {
        const last = messages[messages.length - 1];
        if (last && last.isStreaming) {
          last.content += content;
        } else {
          messages.push({
            role: "assistant",
            content,
            isStreaming: true,
          });
        }
      },

      onEnhancedImage(image: string) {
        enhancedImage = image;
        activePreviewTab = "enhanced";
      },

      onMessage(content: string, followUpCommands: string[]) {
        const last = messages[messages.length - 1];
        if (last && last.isStreaming) {
          last.content = content || last.content;
          last.followUpSuggestions = followUpCommands;
          last.isStreaming = false;
        } else {
          messages.push({
            role: "assistant",
            content,
            followUpSuggestions: followUpCommands,
          });
        }
        scheduleSave();
      },

      onError(message: string) {
        const last = messages[messages.length - 1];
        if (last && last.isStreaming) {
          last.content += `\n\nError: ${message}`;
          last.isStreaming = false;
        } else {
          messages.push({
            role: "assistant",
            content: `Error: ${message}`,
          });
        }
        scheduleSave();
      },

      onDone() {
        const last = messages[messages.length - 1];
        if (last && last.isStreaming) {
          last.isStreaming = false;
        }
        isLoading = false;
        statusMessage = null;
        scheduleSave();
      },

      async renderAndCapture(mermaidCode: string) {
        codeSource = "ai";
        diagramCode = mermaidCode;
        activePreviewTab = "mermaid";

        if (renderMermaidCode) {
          const result = await renderMermaidCode(mermaidCode);
          if (result.error) {
            return { error: result.error };
          }
        }

        return { success: true };
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
    await sendChatRequestWithOptions(userMessage, contextDiagram, false);
  }

  async function sendChatRequestWithOptions(
    userMessage: string,
    contextDiagram: string | null,
    forceEnhance: boolean,
  ) {
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
      force_enhance: forceEnhance,
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

  function clearFollowUps() {
    for (const m of messages) {
      m.followUpSuggestions = undefined;
    }
  }

  function handleUserSubmit(text: string) {
    clearFollowUps();
    messages.push({ role: "user", content: text });
    scheduleSave();
    sendChatRequest(text, diagramCode);
  }

  function handleForceEnhance(text: string) {
    const message =
      text.trim() ||
      "Enhance this diagram's layout, alignment, spacing, and overall readability.";
    clearFollowUps();
    messages.push({ role: "user", content: message });
    scheduleSave();
    sendChatRequestWithOptions(message, diagramCode, true);
  }

  async function handleImageUpload(file: File, userMessage: string) {
    clearFollowUps();
    const previewUrl = URL.createObjectURL(file);
    messages.push({
      role: "user",
      content: userMessage || "Convert this image to a Mermaid diagram",
      imageUrl: previewUrl,
    });

    isLoading = true;

    const history = buildHistory(messages, { skip: "both" });

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
    scheduleSave();
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

  function clearHistory() {
    messages.splice(0, messages.length, WELCOME_MESSAGE);
    diagramCode = DEFAULT_DIAGRAM;
    enhancedImage = null;
    activePreviewTab = "mermaid";
    codeSource = "user";
    try {
      localStorage.removeItem(STORAGE_MESSAGES);
      localStorage.removeItem(STORAGE_CODE);
    } catch {}
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
    handleForceEnhance,
    handleImageUpload,
    handleCodeChange,
    handleFixRequest,
    stopAgent,
    clearHistory,
  };
}
