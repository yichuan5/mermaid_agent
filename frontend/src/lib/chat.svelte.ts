import type { Message } from "$lib/types";
import { sendChat, sendImage } from "$lib/api";

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

  let messages = $state<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your Mermaid diagram assistant. Describe a diagram and I'll generate it for you. You can also ask me to update the current diagram!",
    },
  ]);
  let isLoading = $state(false);

  // Callback to capture a diagram screenshot — set by the page component
  let getDiagramImage: (() => Promise<string | null>) | null = null;

  async function sendChatRequest(
    userMessage: string,
    contextDiagram: string | null,
    isAutoFix = false,
  ) {
    if (!isAutoFix) autoFixCount = 0;
    isLoading = true;
    try {
      const history = messages
        .slice(1, -1)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));

      if (contextDiagram === DEFAULT_DIAGRAM) {
        contextDiagram = null;
      }

      let current_diagram_image = null;
      if (getDiagramImage && contextDiagram) {
        current_diagram_image = await getDiagramImage();
      }

      const data = await sendChat({
        message: userMessage,
        current_diagram: contextDiagram,
        current_diagram_image,
        history,
      });

      messages.push({
        role: "assistant",
        content: data.explanation,
        followUpSuggestions: data.follow_up_commands,
      });

      if (data.mermaid_code) {
        if (isAutoFix && data.mermaid_code === diagramCode) {
          messages.push({
            role: "system",
            content:
              "The AI returned the exact same broken code. Auto-fix aborted. Please provide more context or fix the code manually.",
          });
          autoFixCount = MAX_AUTO_FIX;
        } else {
          codeSource = "ai";
          diagramCode = data.mermaid_code;
        }
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

  function handleRenderError(code: string, error: string) {
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

    const fixPrompt =
      `The Mermaid code you just generated failed to render with this error:\n\n` +
      `Error: ${error}\n\n` +
      `Please fix the syntax and return corrected Mermaid code.`;

    sendChatRequest(fixPrompt, code, true).finally(() => {
      autoFixPending = false;
    });
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
  };
}
