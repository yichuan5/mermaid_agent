import type { Message } from "$lib/types";
import { sendChat, sendFix, sendImage } from "$lib/api";
import { CHART_SAMPLES } from "$lib/chartSamples";

/**
 * Build a conversation history suitable for the backend.
 * - Excludes system messages
 * - Removes consecutive entries with the same role (keeps the last one)
 *   so the array always strictly alternates user/assistant.
 */
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

  // Deduplicate consecutive same-role entries (keep the last of each run)
  const deduped: { role: string; content: string }[] = [];
  for (const m of filtered) {
    if (deduped.length > 0 && deduped[deduped.length - 1].role === m.role) {
      deduped[deduped.length - 1] = m; // replace with the later one
    } else {
      deduped.push(m);
    }
  }

  return deduped.slice(-20);
}


const MAX_AUTO_FIX = 3;

export function createChatStore() {
  let diagramCode = $state(CHART_SAMPLES["flowchart"]);
  let codeSource: "ai" | "user" = $state("user");
  let autoFixPending = $state(false);
  let autoFixCount = $state(0);
  let fixAttempts = $state<{ code: string; error: string }[]>([]);

  let messages = $state<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your Mermaid diagram assistant. Describe a diagram in detail and I'll draft it for you.",
    },
  ]);
  let isLoading = $state(false);

  // Callback to capture a diagram screenshot — set by the page component
  let getDiagramImage: (() => Promise<string | null>) | null = null;

  async function sendChatRequest(
    userMessage: string,
    contextDiagram: string | null,
  ) {
    autoFixCount = 0;
    fixAttempts = [];
    isLoading = true;
    try {
      const history = buildHistory(messages, { skip: "both" });

      if (contextDiagram === CHART_SAMPLES["flowchart"]) {
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
    } catch (e: any) {
      messages.push({
        role: "assistant",
        content: `Error: ${e.message ?? "Could not reach the backend. Is it running?"}`,
      });
    } finally {
      isLoading = false;
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

  function handleChartTypeChange(type: string) {
    const sample = CHART_SAMPLES[type];
    if (sample) {
      codeSource = "user";
      diagramCode = sample;
    }
  }

  return {
    get diagramCode() { return diagramCode; },
    get messages() { return messages; },
    get isLoading() { return isLoading; },
    set getDiagramImage(fn: (() => Promise<string | null>) | null) { getDiagramImage = fn; },
    handleUserSubmit,
    handleImageUpload,
    handleCodeChange,
    handleRenderError,
    handleFixRequest,
    handleChartTypeChange,
  };
}
