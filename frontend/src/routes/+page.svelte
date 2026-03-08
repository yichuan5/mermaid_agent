<script lang="ts">
  import ChatPanel from "$lib/ChatPanel.svelte";
  import Editor from "$lib/Editor.svelte";
  import Preview from "$lib/Preview.svelte";
  import type { Message } from "$lib/types";

  const BACKEND_URL = "http://localhost:8000";

  // ── Diagram state ──────────────────────────────────────────────
  let previewComponent: ReturnType<typeof Preview>;
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

  let diagramCode = $state(DEFAULT_DIAGRAM);

  // Track where the current code came from: only auto-fix AI output
  let codeSource: "ai" | "user" = "user";
  let autoFixPending = false; // debounce: only one auto-fix at a time

  // ── Chat state ─────────────────────────────────────────────────

  let messages = $state<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your Mermaid diagram assistant. Describe a diagram and I'll generate it for you. You can also ask me to update the current diagram!",
    },
  ]);
  let isLoading = $state(false);

  // ── AI call ────────────────────────────────────────────────────
  async function callAI(userMessage: string, contextDiagram: string | null) {
    isLoading = true;
    try {
      const history = messages
        .slice(1, -1) // skip greeting & current message
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-20) // cap to last 20 to avoid huge payloads
        .map((m) => ({ role: m.role, content: m.content }));

      if (contextDiagram === DEFAULT_DIAGRAM) {
        contextDiagram = null;
      }

      let current_diagram_image = null;
      if (previewComponent && contextDiagram) {
        current_diagram_image = await previewComponent.getDiagramImageBase64();
      }

      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          current_diagram: contextDiagram,
          current_diagram_image,
          history,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Server error ${res.status}`);
      }
      const data: {
        mermaid_code: string | null;
        explanation: string;
        follow_up_suggestions: string[];
      } = await res.json();

      messages.push({
        role: "assistant",
        content: data.explanation,
        followUpSuggestions: data.follow_up_suggestions,
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

  // ── Handlers ───────────────────────────────────────────────────
  function handleUserSubmit(text: string) {
    messages.push({ role: "user", content: text });
    callAI(text, diagramCode);
  }

  async function handleImageUpload(file: File, userMessage: string) {
    // Create a preview URL for the chat message
    const previewUrl = URL.createObjectURL(file);
    messages.push({
      role: "user",
      content: userMessage || "Convert this image to a Mermaid diagram",
      imageUrl: previewUrl,
    });

    isLoading = true;
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("message", userMessage);

      const res = await fetch(`${BACKEND_URL}/api/chat/image`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Server error ${res.status}`);
      }

      const data: {
        mermaid_code: string | null;
        explanation: string;
        follow_up_suggestions: string[];
      } = await res.json();

      messages.push({
        role: "assistant",
        content: data.explanation,
        followUpSuggestions: data.follow_up_suggestions,
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

  function handleCodeChange(code: string) {
    codeSource = "user"; // user is now editing manually
    diagramCode = code;
  }

  function handleAIUpdate(code: string) {
    codeSource = "ai";
    diagramCode = code;
  }

  function handleRenderError(code: string, error: string) {
    // Only auto-fix if the broken code came from the AI, and no fix is in flight
    if (codeSource !== "ai" || autoFixPending || isLoading) return;
    autoFixPending = true;

    messages.push({
      role: "system",
      content: `Rendering error detected — asking AI to fix it automatically…\n\`${error.split("\n")[0]}\``,
    });

    const fixPrompt =
      `The Mermaid code you just generated failed to render with this error:\n\n` +
      `Error: ${error}\n\n` +
      `Please fix the syntax and return corrected Mermaid code.`;

    callAI(fixPrompt, code).finally(() => {
      autoFixPending = false;
    });
  }

  // ── Panel resize ───────────────────────────────────────────────
  let widths = $state([22, 39, 39]);
  const MIN_PCT = 10;
  let isDragging = $state(false);
  let panelsEl: HTMLElement;

  function startDrag(panelIndex: 0 | 1, e: PointerEvent) {
    e.preventDefault();
    const divider = e.currentTarget as HTMLElement;
    divider.setPointerCapture(e.pointerId);
    isDragging = true;
    const startX = e.clientX;
    const startWidths = [...widths];
    const containerWidth = panelsEl.getBoundingClientRect().width;

    function onMove(ev: PointerEvent) {
      const dpct = ((ev.clientX - startX) / containerWidth) * 100;
      const next = [...startWidths];
      next[panelIndex] = startWidths[panelIndex] + dpct;
      next[panelIndex + 1] = startWidths[panelIndex + 1] - dpct;
      if (next[panelIndex] < MIN_PCT) {
        next[panelIndex + 1] += next[panelIndex] - MIN_PCT;
        next[panelIndex] = MIN_PCT;
      }
      if (next[panelIndex + 1] < MIN_PCT) {
        next[panelIndex] += next[panelIndex + 1] - MIN_PCT;
        next[panelIndex + 1] = MIN_PCT;
      }
      widths = next;
    }
    function onUp(ev: PointerEvent) {
      divider.releasePointerCapture(ev.pointerId);
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onUp);
      isDragging = false;
    }
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp);
  }
</script>

<svelte:head>
  <title>Mermaid Agent</title>
  <meta
    name="description"
    content="AI-powered Mermaid diagram generator with live editing"
  />
</svelte:head>

<div class="app-shell" class:dragging={isDragging}>
  <header class="app-header">
    <div class="logo">
      <span class="logo-icon">◈</span>
      <span class="logo-text">Mermaid Agent</span>
    </div>
    <p class="tagline">AI-powered diagram generation & editing</p>
  </header>

  <main
    class="panels"
    bind:this={panelsEl}
    style="grid-template-columns: {widths[0]}% 4px {widths[1]}% 4px {widths[2]}%"
  >
    <ChatPanel
      {messages}
      {isLoading}
      onSubmit={handleUserSubmit}
      onImageUpload={handleImageUpload}
    />

    <div
      class="divider"
      class:active={isDragging}
      onpointerdown={(e) => startDrag(0, e)}
      role="separator"
      aria-label="Resize chat and editor panels"
    ></div>

    <Editor code={diagramCode} onCodeChange={handleCodeChange} />

    <div
      class="divider"
      class:active={isDragging}
      onpointerdown={(e) => startDrag(1, e)}
      role="separator"
      aria-label="Resize editor and preview panels"
    ></div>

    <Preview
      bind:this={previewComponent}
      code={diagramCode}
      onRenderError={handleRenderError}
    />
  </main>
</div>
