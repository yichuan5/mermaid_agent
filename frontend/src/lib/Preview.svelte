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

  export async function getDiagramImageBase64(): Promise<string | null> {
    const svgEl = wrapperEl?.querySelector("svg");
    if (!svgEl) return null;

    // Clone the SVG so we can modify it without affecting the live preview
    const clone = svgEl.cloneNode(true) as SVGSVGElement;

    // Inline all computed styles so text/colors render in the <img> context
    inlineStyles(svgEl, clone);

    // Determine real pixel dimensions from the rendered SVG
    const bbox = svgEl.getBoundingClientRect();
    const w = Math.ceil(bbox.width);
    const h = Math.ceil(bbox.height);

    // Set explicit width/height (required for canvas rendering)
    clone.setAttribute("width", `${w}`);
    clone.setAttribute("height", `${h}`);

    // Serialise and encode as base64 data URL (more reliable than blob URL for canvas)
    const svgData = new XMLSerializer().serializeToString(clone);
    const bytes = new TextEncoder().encode(svgData);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const dataUrl = `data:image/svg+xml;base64,${base64}`;

    const scale = 2; // 2× for crisp output

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(scale, scale);
        ctx.fillStyle = previewDark ? "#0f1117" : "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        // We only want the base64 string without the data:image/png;base64, prefix
        const dataUrl = canvas.toDataURL("image/png");
        resolve(dataUrl.split(",")[1]);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
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
    theme: "dark" as const,
  };

  const lightThemeConfig = {
    startOnLoad: false,
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
        const msg = e?.message ?? "Invalid Mermaid syntax";
        renderError = msg;
        setTimeout(() => onRenderError?.(source, msg), 300);
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

  async function downloadPNG() {
    const base64 = await getDiagramImageBase64();
    if (!base64) return;

    // convert base64 back to blob for download
    const res = await fetch(`data:image/png;base64,${base64}`);
    const blob = await res.blob();
    triggerDownload(blob, "diagram.png");
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
</script>

<section class="panel preview-panel" class:preview-light={!previewDark}>
  <div class="panel-header">
    <span class="panel-icon"></span>
    <h2>Live Preview</h2>

    <!-- Dark / Light toggle -->
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

    <!-- Download dropdown -->
    <div class="download-wrapper" bind:this={downloadBtnEl}>
      <button
        class="download-btn"
        onclick={() => (showDownloadMenu = !showDownloadMenu)}
        title="Download diagram"
        aria-label="Download diagram"
        disabled={!!renderError || !code.trim()}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
      {#if showDownloadMenu}
        <div class="download-menu">
          <button class="download-menu-item" onclick={downloadSVG}>
            <span class="download-menu-label">
              <strong>SVG</strong>
            </span>
          </button>
          <button class="download-menu-item" onclick={downloadPNG}>
            <span class="download-menu-label">
              <strong>PNG</strong>
            </span>
          </button>
        </div>
      {/if}
    </div>

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
