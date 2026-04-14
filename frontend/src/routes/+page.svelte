<script lang="ts">
  import { onMount } from "svelte";
  import ChatPanel from "$lib/ChatPanel.svelte";
  import Editor from "$lib/Editor.svelte";
  import Preview from "$lib/Preview.svelte";
  import { createChatStore } from "$lib/chat.svelte";

  const chat = createChatStore();
  let hydrated = $state(false);
  onMount(() => { hydrated = true; });

  // ── Diagram image capture & render for WS agent tools ──────────
  let previewComponent: ReturnType<typeof Preview>;
  $effect(() => {
    chat.getDiagramImage = previewComponent
      ? () => previewComponent.getDiagramImageForAI()
      : null;
    chat.renderMermaidCode = previewComponent
      ? (code: string) => previewComponent.renderAndGetResult(code)
      : null;
  });

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

<div class="app-shell" class:dragging={isDragging} data-hydrated={hydrated || undefined}>
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
      messages={chat.messages}
      isLoading={chat.isLoading}
      statusMessage={chat.statusMessage}
      onSubmit={chat.handleUserSubmit}
      onForceEnhance={chat.handleForceEnhance}
      onStop={chat.stopAgent}
      onImageUpload={chat.handleImageUpload}
      onClearHistory={chat.clearHistory}
      chartType={chat.chartType}
      onChartTypeChange={(ct) => (chat.chartType = ct)}
    />

    <div
      class="divider"
      class:active={isDragging}
      onpointerdown={(e) => startDrag(0, e)}
      role="separator"
      aria-label="Resize chat and editor panels"
    ></div>

    <Editor code={chat.diagramCode} onCodeChange={chat.handleCodeChange} onFocus={() => (chat.activePreviewTab = "mermaid")} />

    <div
      class="divider"
      class:active={isDragging}
      onpointerdown={(e) => startDrag(1, e)}
      role="separator"
      aria-label="Resize editor and preview panels"
    ></div>

    <Preview
      bind:this={previewComponent}
      code={chat.diagramCode}
      onFixRequest={chat.handleFixRequest}
      isLoading={chat.isLoading}
      activeTab={chat.activePreviewTab}
      enhancedImage={chat.enhancedImage}
      onTabChange={(tab) => (chat.activePreviewTab = tab)}
    />
  </main>
</div>
