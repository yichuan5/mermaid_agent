import type { Message } from "$lib/types";
import { sendChat, sendFix, sendImage, sendEnhance } from "$lib/api";

export type Mode = "auto" | "generate" | "enhance";
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

const MAX_AUTO_FIX = 3;

export function createChatStore() {
  let diagramCode = $state(DEFAULT_DIAGRAM);
  let codeSource: "ai" | "user" = $state("user");
  let autoFixPending = $state(false);
  let autoFixCount = $state(0);
  let fixAttempts = $state<{ code: string; error: string }[]>([]);

  let messages = $state<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your Mermaid diagram assistant. Describe a diagram in detail and I'll generate it for you.",
    },
  ]);
  let isLoading = $state(false);

  // Mode & chart type selections
  let mode: Mode = $state("auto");
  let chartType: string | null = $state(null);

  // Enhancement state
  let enhancedImage: string | null = $state(null);
  let activePreviewTab: PreviewTab = $state("mermaid");
  let isEnhancing = $state(false);

  // Callback to capture a diagram screenshot — set by the page component
  let getDiagramImage: (() => Promise<string | null>) | null = null;

  // Callback to wait for mermaid render to complete — set by page component
  let waitForRender: (() => Promise<void>) | null = null;

  async function runEnhance(userMessage: string, instructions?: string | null) {
    if (!getDiagramImage) return;
    isEnhancing = true;
    activePreviewTab = "enhanced";
    try {
      const image = await getDiagramImage();
      if (!image) {
        isEnhancing = false;
        activePreviewTab = "mermaid";
        return;
      }
      const result = await sendEnhance({
        image,
        message: userMessage,
        instructions: instructions ?? undefined,
      });
      if (result.enhanced_image) {
        enhancedImage = result.enhanced_image;
        if (result.explanation) {
          messages.push({ role: "system", content: result.explanation });
        }
      } else {
        activePreviewTab = "mermaid";
        if (result.explanation) {
          messages.push({ role: "system", content: result.explanation });
        }
      }
    } catch (e: any) {
      activePreviewTab = "mermaid";
      messages.push({
        role: "assistant",
        content: `Enhancement error: ${e.message ?? "Could not reach the backend."}`,
      });
    } finally {
      isEnhancing = false;
    }
  }

  async function sendChatRequest(
    userMessage: string,
    contextDiagram: string | null,
  ) {
    autoFixCount = 0;
    fixAttempts = [];
    isLoading = true;

    if (mode === "enhance") {
      isLoading = false;
      await runEnhance(userMessage);
      return;
    }

    try {
      const history = buildHistory(messages, { skip: "both" });

      if (contextDiagram === DEFAULT_DIAGRAM) {
        contextDiagram = null;
      }

      let current_image = null;
      if (getDiagramImage && contextDiagram) {
        current_image = await getDiagramImage();
      }

      const data = await sendChat({
        message: userMessage,
        current_mermaid_code: contextDiagram,
        current_image,
        history,
        mode,
        chart_type: chartType,
      });

      messages.push({
        role: "assistant",
        content: data.explanation,
        followUpSuggestions: data.follow_up_commands,
      });

      if (data.mermaid_code) {
        codeSource = "ai";
        diagramCode = data.mermaid_code;
      }

      if (mode === "generate") {
        activePreviewTab = "mermaid";
      }
    } catch (e: any) {
      messages.push({
        role: "assistant",
        content: `Error: ${e.message ?? "Could not reach the backend. Is it running?"}`,
      });
    } finally {
      isLoading = false;
    }

    // Auto mode: after code gen + render, evaluate with enhance agent
    if (mode === "auto") {
      if (waitForRender) {
        await waitForRender();
      }
      await runEnhance(userMessage);
    }
  }

  function handleUserSubmit(text: string) {
    messages.push({ role: "user", content: text });
    sendChatRequest(text, diagramCode);
  }

  async function handleImageUpload(file: File, userMessage: string) {
    autoFixCount = 0;
    fixAttempts = [];
    const previewUrl = URL.createObjectURL(file);
    messages.push({
      role: "user",
      content: userMessage || "Convert this image to a Mermaid diagram",
      imageUrl: previewUrl,
    });

    isLoading = true;
    try {
      const data = await sendImage(file, userMessage);

      messages.push({
        role: "assistant",
        content: data.explanation,
        followUpSuggestions: data.follow_up_commands,
      });

      if (data.mermaid_code) {
        codeSource = "ai";
        diagramCode = data.mermaid_code;
      }
    } catch (e: any) {
      messages.push({
        role: "assistant",
        content: `Error: ${e.message ?? "Could not reach the backend. Is it running?"}`,
      });
    } finally {
      isLoading = false;
      URL.revokeObjectURL(previewUrl);
    }
  }

  function handleCodeChange(code: string) {
    codeSource = "user";
    diagramCode = code;
  }

  async function performFix(code: string, error: string): Promise<void> {
    const history = buildHistory(messages, { skip: "first" });

    const data = await sendFix({
      broken_code: code,
      error,
      history,
      fix_attempts: fixAttempts,
    });

    fixAttempts = [...fixAttempts, { code, error }];

    if (data.mermaid_code) {
      codeSource = "ai";
      diagramCode = data.mermaid_code;
    }
  }

  async function handleRenderError(code: string, error: string) {
    if (codeSource !== "ai" || autoFixPending || isLoading) return;

    if (autoFixCount >= MAX_AUTO_FIX) {
      if (autoFixCount === MAX_AUTO_FIX) {
        messages.push({
          role: "system",
          content: `Auto-fix limit reached (${MAX_AUTO_FIX} attempts). Please fix the code manually.`,
        });
        autoFixCount++;
      }
      return;
    }

    autoFixPending = true;
    autoFixCount++;

    messages.push({
      role: "system",
      content: `Rendering error detected — asking AI to fix it automatically (Attempt ${autoFixCount}/${MAX_AUTO_FIX})...\n\`${error.split("\n")[0]}\``,
    });

    try {
      isLoading = true;
      await performFix(code, error);
    } catch (e: any) {
      messages.push({
        role: "assistant",
        content: `Error: ${e.message ?? "Could not reach the backend. Is it running?"}`,
      });
    } finally {
      isLoading = false;
      autoFixPending = false;
    }
  }

  async function handleFixRequest(code: string, error: string) {
    if (isLoading || autoFixPending) return;
    autoFixCount = 0;
    fixAttempts = [];
    autoFixPending = true;

    messages.push({
      role: "system",
      content: `Asking AI to fix the code...\n\`${error.split("\n")[0]}\``,
    });
    try {
      isLoading = true;
      await performFix(code, error);
    } catch (e: any) {
      messages.push({
        role: "assistant",
        content: `Error: ${e.message ?? "Could not reach the backend. Is it running?"}`,
      });
    } finally {
      isLoading = false;
      autoFixPending = false;
    }
  }

  async function handleManualEnhance(instructions?: string) {
    if (isLoading || isEnhancing) return;
    await runEnhance("", instructions);
  }

  return {
    get diagramCode() { return diagramCode; },
    get messages() { return messages; },
    get isLoading() { return isLoading; },
    get mode() { return mode; },
    set mode(v: Mode) { mode = v; },
    get chartType() { return chartType; },
    set chartType(v: string | null) { chartType = v; },
    get enhancedImage() { return enhancedImage; },
    get activePreviewTab() { return activePreviewTab; },
    set activePreviewTab(v: PreviewTab) { activePreviewTab = v; },
    get isEnhancing() { return isEnhancing; },
    set getDiagramImage(fn: (() => Promise<string | null>) | null) { getDiagramImage = fn; },
    set waitForRender(fn: (() => Promise<void>) | null) { waitForRender = fn; },
    handleUserSubmit,
    handleImageUpload,
    handleCodeChange,
    handleRenderError,
    handleFixRequest,
    handleManualEnhance,
  };
}
