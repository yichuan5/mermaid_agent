<script lang="ts">
  import mermaid from "mermaid";
  import { onMount } from "svelte";

  let {
    code,
    onRenderError,
  }: {
    code: string;
    onRenderError?: (code: string, error: string) => void;
  } = $props();

  let wrapperEl: HTMLDivElement; // the scaled/translated diagram
  let containerEl: HTMLDivElement; // the clipping viewport
  let renderError = $state("");
  let debounceTimer: ReturnType<typeof setTimeout>;
  let renderCount = 0;

  // ── View state (zoom + pan) ──────────────────────────────────────
  let zoom = $state(1.0);
  let panX = $state(0);
  let panY = $state(0);
  let isPanning = $state(false);

  const ZOOM_MIN = 0.05;
  const ZOOM_MAX = 8.0;
  const ZOOM_STEP = 0.12;

  const zoomPct = $derived(Math.round(zoom * 100));

  function resetView() {
    zoom = 1.0;
    panX = 0;
    panY = 0;
  }

  // Zoom toward the cursor position
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = containerEl.getBoundingClientRect();
    const cx = e.clientX - rect.left; // cursor relative to container
    const cy = e.clientY - rect.top;

    const oldZoom = zoom;
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta));

    // Adjust pan so the point under cursor stays fixed
    const ratio = newZoom / oldZoom;
    panX = cx - ratio * (cx - panX);
    panY = cy - ratio * (cy - panY);
    zoom = newZoom;
  }

  // Drag-to-pan with pointer capture
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // left click only
    e.preventDefault();
    containerEl.setPointerCapture(e.pointerId);
    isPanning = true;
    const startX = e.clientX - panX;
    const startY = e.clientY - panY;

    function onMove(ev: PointerEvent) {
      panX = ev.clientX - startX;
      panY = ev.clientY - startY;
    }
    function onUp(ev: PointerEvent) {
      containerEl.releasePointerCapture(ev.pointerId);
      containerEl.removeEventListener("pointermove", onMove);
      containerEl.removeEventListener("pointerup", onUp);
      isPanning = false;
    }
    containerEl.addEventListener("pointermove", onMove);
    containerEl.addEventListener("pointerup", onUp);
  }

  // ── Mermaid ─────────────────────────────────────────────────────
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
      darkMode: true,
      background: "#0f1117",
      primaryColor: "#6366f1",
      primaryTextColor: "#e2e8f0",
      primaryBorderColor: "#4f46e5",
      lineColor: "#818cf8",
      secondaryColor: "#1e1b4b",
      tertiaryColor: "#1e293b",
    },
  });

  async function renderDiagram(source: string) {
    if (!wrapperEl || !source.trim()) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        renderError = "";
        const id = `mermaid-${++renderCount}`;
        const { svg } = await mermaid.render(id, source);
        wrapperEl.innerHTML = svg;
        const svgEl = wrapperEl.querySelector("svg");
        if (svgEl) {
          svgEl.style.maxWidth = "none";
          svgEl.style.height = "auto";
          svgEl.style.display = "block";
        }
      } catch (e: any) {
        const msg = e?.message ?? "Invalid Mermaid syntax";
        renderError = msg;
        setTimeout(() => onRenderError?.(source, msg), 300);
      }
    }, 400);
  }

  onMount(() => renderDiagram(code));
  $effect(() => {
    renderDiagram(code);
  });
</script>

<section class="panel preview-panel">
  <div class="panel-header">
    <span class="panel-icon"></span>
    <h2>Live Preview</h2>

    <div class="zoom-controls">
      <button
        class="zoom-btn"
        onclick={() => (zoom = Math.max(ZOOM_MIN, zoom - ZOOM_STEP * 2))}
        title="Zoom out">−</button
      >
      <button class="zoom-reset" onclick={resetView} title="Reset view"
        >{zoomPct}%</button
      >
      <button
        class="zoom-btn"
        onclick={() => (zoom = Math.min(ZOOM_MAX, zoom + ZOOM_STEP * 2))}
        title="Zoom in">+</button
      >
    </div>

    {#if renderError}
      <span class="error-badge">Syntax error</span>
    {/if}
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="preview-container"
    class:panning={isPanning}
    bind:this={containerEl}
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    role="img"
    aria-label="Mermaid diagram preview — scroll to zoom, drag to pan"
  >
    {#if renderError}
      <div class="error-overlay">
        <span class="error-icon"></span>
        <p class="error-title">Rendering Error</p>
        <pre class="error-msg">{renderError}</pre>
      </div>
    {/if}

    <div
      class="diagram-wrapper"
      bind:this={wrapperEl}
      style="transform: translate({panX}px, {panY}px) scale({zoom}); transform-origin: 0 0;"
    ></div>
  </div>
</section>
