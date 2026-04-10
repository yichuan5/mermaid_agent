<script lang="ts">
  import mermaid from "mermaid";
  import { onMount, onDestroy } from "svelte";
  import type { PreviewTab } from "$lib/chat.svelte";

  let {
    code,
    onFixRequest,
    isLoading = false,
    activeTab = "mermaid",
    enhancedImage = null,
    onTabChange,
  }: {
    code: string;
    onFixRequest?: (code: string, error: string) => void;
    isLoading?: boolean;
    activeTab?: PreviewTab;
    enhancedImage?: string | null;
    onTabChange?: (tab: PreviewTab) => void;
  } = $props();

  /**
   * Shared helper: renders the current diagram SVG to a JPEG base64 string.
   * @param scale     Pixel multiplier (e.g. 1 for AI context, 2 for download)
   * @param maxSide   Cap the longest side to this many pixels (Infinity = no cap)
   * @param quality   JPEG quality 0–1
   */
  async function svgToJpeg(
    scale: number,
    maxSide: number,
    quality: number,
  ): Promise<string | null> {
    const svgEl = wrapperEl?.querySelector("svg");
    if (!svgEl) return null;

    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    inlineStyles(svgEl, clone);

    const bbox = svgEl.getBoundingClientRect();
    const effectiveScale =
      scale * Math.min(1, maxSide / Math.max(bbox.width, bbox.height, 1));
    const w = Math.ceil(bbox.width * effectiveScale);
    const h = Math.ceil(bbox.height * effectiveScale);

    clone.setAttribute("width", `${w}`);
    clone.setAttribute("height", `${h}`);

    const svgData = new XMLSerializer().serializeToString(clone);
    const bytes = new TextEncoder().encode(svgData);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++)
      binary += String.fromCharCode(bytes[i]);
    const dataUrl = `data:image/svg+xml;base64,${btoa(binary)}`;

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = previewDark ? "#0f1117" : "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  /** Low-res snapshot for LLM context: 1× scale, capped at 1024 px, JPEG 80%. */
  export async function getDiagramImageForAI(): Promise<string | null> {
    return svgToJpeg(1, 1024, 0.8);
  }

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

  // ── Dark / Light preview mode ────────────────────────────────────
  let previewDark = $state(false);

  // ── Enhanced image zoom/pan ──────────────────────────────────────
  let enhancedContainerEl: HTMLDivElement;
  let enhancedZoom = $state(1.0);
  let enhancedPanX = $state(0);
  let enhancedPanY = $state(0);
  let isEnhancedPanning = $state(false);

  const enhancedZoomPct = $derived(Math.round(enhancedZoom * 100));

  function resetEnhancedView() {
    enhancedZoom = 1.0;
    enhancedPanX = 0;
    enhancedPanY = 0;
  }

  function onEnhancedWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = enhancedContainerEl.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const oldZoom = enhancedZoom;
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, enhancedZoom + delta));
    const ratio = newZoom / oldZoom;
    enhancedPanX = cx - ratio * (cx - enhancedPanX);
    enhancedPanY = cy - ratio * (cy - enhancedPanY);
    enhancedZoom = newZoom;
  }

  function onEnhancedPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    enhancedContainerEl.setPointerCapture(e.pointerId);
    isEnhancedPanning = true;
    const startX = e.clientX - enhancedPanX;
    const startY = e.clientY - enhancedPanY;
    function onMove(ev: PointerEvent) {
      enhancedPanX = ev.clientX - startX;
      enhancedPanY = ev.clientY - startY;
    }
    function onUp(ev: PointerEvent) {
      enhancedContainerEl.releasePointerCapture(ev.pointerId);
      enhancedContainerEl.removeEventListener("pointermove", onMove);
      enhancedContainerEl.removeEventListener("pointerup", onUp);
      isEnhancedPanning = false;
    }
    enhancedContainerEl.addEventListener("pointermove", onMove);
    enhancedContainerEl.addEventListener("pointerup", onUp);
  }

  // No longer need renderResolve — agent uses renderAndGetResult directly

  /**
   * Render mermaid code immediately (bypassing debounce) and return the result.
   * Used by the WS agent's render_and_capture tool.
   */
  export async function renderAndGetResult(source: string): Promise<{ error?: string }> {
    if (!wrapperEl || !source.trim()) return { error: "No render target available" };
    clearTimeout(debounceTimer);
    try {
      renderError = "";
      const id = `mermaid-${++renderCount}`;
      const { svg } = await mermaid.render(id, source);
      wrapperEl.innerHTML = svg;
      const svgEl = wrapperEl.querySelector("svg");
      if (svgEl) fixSvgClipping(svgEl);
      return {};
    } catch (e: any) {
      const msg = e?.message ?? "Invalid Mermaid syntax";
      renderError = msg;
      return { error: msg };
    }
  }

  // ── Download dropdown ─────────────────────────────────────────────
  let showDownloadMenu = $state(false);
  let downloadBtnEl: HTMLDivElement;

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
  const darkThemeConfig = {
    startOnLoad: false,
    securityLevel: "strict" as const,
    theme: "dark" as const,
  };

  const lightThemeConfig = {
    startOnLoad: false,
    securityLevel: "strict" as const,
    theme: "default" as const,
  };

  function initMermaid(dark: boolean) {
    mermaid.initialize(dark ? darkThemeConfig : lightThemeConfig);
  }

  /** Expand a tight Mermaid viewBox so titles / labels aren't clipped */
  function fixSvgClipping(svgEl: SVGSVGElement) {
    svgEl.style.maxWidth = "none";
    svgEl.style.height = "auto";
    svgEl.style.display = "block";
    svgEl.style.overflow = "visible";
    const vb = svgEl.getAttribute("viewBox");
    if (vb) {
      const [x, y, w, h] = vb.split(/[\s,]+/).map(Number);
      if ([x, y, w, h].every(isFinite))
        svgEl.setAttribute(
          "viewBox",
          `${x - 20} ${y - 20} ${w + 40} ${h + 40}`,
        );
    }
  }

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
        if (svgEl) fixSvgClipping(svgEl);
      } catch (e: any) {
        renderError = e?.message ?? "Invalid Mermaid syntax";
      }
    }, 400);
  }

  function togglePreviewMode() {
    previewDark = !previewDark;
    initMermaid(previewDark);
    renderDiagram(code);
  }

  onMount(() => {
    initMermaid(previewDark);
  });
  $effect(() => {
    renderDiagram(code);
  });

  // ── Download helpers ──────────────────────────────────────────────
  function downloadSVG() {
    const svgEl = wrapperEl?.querySelector("svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    triggerDownload(blob, "diagram.svg");
    showDownloadMenu = false;
  }

  async function downloadJPEG() {
    const base64 = await svgToJpeg(2, Infinity, 0.9);
    if (!base64) return;
    const res = await fetch(`data:image/jpeg;base64,${base64}`);
    const blob = await res.blob();
    triggerDownload(blob, "diagram.jpg");
    showDownloadMenu = false;
  }

  /** Walk the DOM tree and copy computed styles onto the clone's inline style */
  function inlineStyles(source: Element, target: Element) {
    const computed = window.getComputedStyle(source);
    const dominated = [
      "fill",
      "stroke",
      "stroke-width",
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "text-anchor",
      "dominant-baseline",
      "alignment-baseline",
      "color",
      "opacity",
    ];
    for (const prop of dominated) {
      const val = computed.getPropertyValue(prop);
      if (val)
        (target as SVGElement | HTMLElement).style.setProperty(prop, val);
    }
    const srcChildren = source.children;
    const tgtChildren = target.children;
    for (let i = 0; i < srcChildren.length; i++) {
      if (tgtChildren[i]) inlineStyles(srcChildren[i], tgtChildren[i]);
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadEnhancedImage() {
    if (!enhancedImage) return;
    const byteString = atob(enhancedImage);
    const ab = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) ab[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: "image/png" });
    triggerDownload(blob, "enhanced-diagram.png");
  }

  function handleClickOutside(e: MouseEvent) {
    if (
      showDownloadMenu &&
      downloadBtnEl &&
      !downloadBtnEl.contains(e.target as Node)
    ) {
      showDownloadMenu = false;
    }
  }

  onMount(() => {
    document.addEventListener("click", handleClickOutside, true);
    return () => {
      document.removeEventListener("click", handleClickOutside, true);
    };
  });

  onDestroy(() => {
    clearTimeout(debounceTimer);
  });
</script>

<section class="panel preview-panel" class:preview-light={!previewDark}>
  <div class="preview-tab-bar">
    <button
      class="preview-tab"
      class:active={activeTab === "mermaid"}
      onclick={() => onTabChange?.("mermaid")}
    >Mermaid</button>
    <button
      class="preview-tab"
      class:active={activeTab === "enhanced"}
      onclick={() => onTabChange?.("enhanced")}
    >AI Enhanced</button>
  </div>

  <div class="panel-header">
    {#if activeTab === "mermaid"}
      <button
        class="theme-toggle"
        onclick={togglePreviewMode}
        title={previewDark ? "Switch to light mode" : "Switch to dark mode"}
        aria-label={previewDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        <span class="theme-toggle-track" class:light={!previewDark}>
          <span class="theme-toggle-icon">{previewDark ? "🌙" : "☀️"}</span>
          <span class="theme-toggle-thumb" class:light={!previewDark}></span>
        </span>
      </button>

      <div class="download-wrapper" bind:this={downloadBtnEl}>
        <button
          class="download-btn"
          onclick={() => (showDownloadMenu = !showDownloadMenu)}
          title="Download diagram"
          aria-label="Download diagram"
          disabled={!!renderError || !code.trim()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        {#if showDownloadMenu}
          <div class="download-menu">
            <button class="download-menu-item" onclick={downloadSVG}>
              <span class="download-menu-label"><strong>SVG</strong></span>
            </button>
            <button class="download-menu-item" onclick={downloadJPEG}>
              <span class="download-menu-label"><strong>JPEG</strong></span>
            </button>
          </div>
        {/if}
      </div>

      <div class="zoom-controls">
        <button class="zoom-btn" onclick={() => (zoom = Math.max(ZOOM_MIN, zoom - ZOOM_STEP * 2))} title="Zoom out">−</button>
        <button class="zoom-reset" onclick={resetView} title="Reset view">{zoomPct}%</button>
        <button class="zoom-btn" onclick={() => (zoom = Math.min(ZOOM_MAX, zoom + ZOOM_STEP * 2))} title="Zoom in">+</button>
      </div>

      {#if renderError}
        <span class="error-badge">Syntax error</span>
      {/if}
    {:else}
      {#if enhancedImage}
        <button class="download-btn" onclick={downloadEnhancedImage} title="Download enhanced image">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>

        <div class="zoom-controls">
          <button class="zoom-btn" onclick={() => (enhancedZoom = Math.max(ZOOM_MIN, enhancedZoom - ZOOM_STEP * 2))} title="Zoom out">−</button>
          <button class="zoom-reset" onclick={resetEnhancedView} title="Reset view">{enhancedZoomPct}%</button>
          <button class="zoom-btn" onclick={() => (enhancedZoom = Math.min(ZOOM_MAX, enhancedZoom + ZOOM_STEP * 2))} title="Zoom in">+</button>
        </div>
      {/if}
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
    style:display={activeTab === "mermaid" ? "block" : "none"}
  >
    {#if renderError}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="error-overlay" onpointerdown={(e) => e.stopPropagation()}>
        <span class="error-icon"></span>
        <p class="error-title">Rendering Error</p>
        <pre class="error-msg">{renderError}</pre>
        {#if onFixRequest}
          <button
            class="fix-btn"
            onclick={() => onFixRequest(code, renderError)}
            disabled={isLoading}
          >
            {isLoading ? "Fixing…" : "Fix with AI"}
          </button>
        {/if}
      </div>
    {/if}

    <div
      class="diagram-wrapper"
      bind:this={wrapperEl}
      style="transform: translate({panX}px, {panY}px) scale({zoom}); transform-origin: 0 0;"
    ></div>
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="preview-container enhanced-container"
    class:panning={isEnhancedPanning}
    bind:this={enhancedContainerEl}
    onwheel={onEnhancedWheel}
    onpointerdown={onEnhancedPointerDown}
    role="img"
    aria-label="Enhanced diagram preview — scroll to zoom, drag to pan"
    style:display={activeTab === "enhanced" ? "flex" : "none"}
  >
    {#if enhancedImage}
      <div
        class="enhanced-wrapper"
        style="transform: translate({enhancedPanX}px, {enhancedPanY}px) scale({enhancedZoom}); transform-origin: 0 0;"
      >
        <img src="data:image/png;base64,{enhancedImage}" alt="AI-enhanced diagram" />
      </div>
    {:else}
      <div class="enhance-placeholder">
        <p>No enhanced image yet.</p>
        <p class="enhance-placeholder-hint">The AI agent will enhance diagrams when it detects layout issues.</p>
      </div>
    {/if}
  </div>
</section>
