<script lang="ts">
  import { tick } from "svelte";
  import type { Message } from "$lib/types";
  import { renderMarkdown } from "$lib/markdown";

  let {
    messages,
    isLoading,
    statusMessage = null,
    onSubmit,
    onStop,
    onImageUpload,
    onClearHistory,
    chartType,
    onChartTypeChange,
  }: {
    messages: Message[];
    isLoading: boolean;
    statusMessage?: string | null;
    onSubmit: (text: string) => void;
    onStop: () => void;
    onImageUpload: (file: File, message: string) => void;
    onClearHistory?: () => void;
    chartType: string | null;
    onChartTypeChange: (chartType: string | null) => void;
  } = $props();

  const CHART_TYPES = [
    { value: null, label: "Auto" },
    { value: "flowchart", label: "Flowchart" },
    { value: "sequenceDiagram", label: "Sequence Diagram" },
    { value: "classDiagram", label: "Class Diagram" },
    { value: "stateDiagram", label: "State Diagram" },
    { value: "entityRelationshipDiagram", label: "ER Diagram" },
    { value: "gantt", label: "Gantt" },
    { value: "mindmap", label: "Mindmap" },
    { value: "timeline", label: "Timeline" },
    { value: "pie", label: "Pie Chart" },
    { value: "gitgraph", label: "Git Graph" },
    { value: "quadrantChart", label: "Quadrant Chart" },
    { value: "sankey", label: "Sankey" },
    { value: "block", label: "Block" },
    { value: "kanban", label: "Kanban" },
    { value: "architecture", label: "Architecture" },
    { value: "xyChart", label: "XY Chart" },
    { value: "radar", label: "Radar" },
    { value: "userJourney", label: "User Journey" },
    { value: "c4", label: "C4" },
    { value: "requirementDiagram", label: "Requirement" },
    { value: "zenuml", label: "ZenUML" },
    { value: "treemap", label: "Treemap" },
    { value: "packet", label: "Packet" },
  ];

  let inputText = $state("");
  let messagesEl: HTMLDivElement;
  let fileInputEl: HTMLInputElement;
  let pendingImage = $state<File | null>(null);
  let imagePreviewUrl = $state<string | null>(null);

  // Scroll to bottom whenever messages change
  $effect(() => {
    messages.length; // track changes
    tick().then(() =>
      messagesEl?.scrollTo({
        top: messagesEl.scrollHeight,
        behavior: "smooth",
      }),
    );
  });

  function sendMessage() {
    const text = inputText.trim();
    if (isLoading) return;

    // If we have a pending image, send it
    if (pendingImage) {
      onImageUpload(pendingImage, text);
      inputText = "";
      clearImage();
      return;
    }

    if (!text) return;
    inputText = "";
    onSubmit(text);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function triggerFileInput() {
    fileInputEl?.click();
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    // Validate type
    const allowed = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/heic",
      "image/heif",
    ];
    if (!allowed.includes(file.type)) {
      alert("Please upload a PNG, JPEG, WebP, HEIC, or HEIF image.");
      return;
    }
    if (file.size > 1 * 1024 * 1024) {
      alert("Image too large. Maximum size is 1 MB.");
      return;
    }

    pendingImage = file;
    imagePreviewUrl = URL.createObjectURL(file);

    // Reset file input so re-selecting the same file triggers change
    target.value = "";
  }

  function clearImage() {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    pendingImage = null;
    imagePreviewUrl = null;
  }
</script>

<section class="panel chat-panel">
  <div class="panel-header">
    {#if onClearHistory}
      <button
        class="new-chat-btn"
        onclick={onClearHistory}
        disabled={isLoading}
        title="Start a new conversation"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New Chat
      </button>
    {/if}
    {#if isLoading}
      <span class="thinking-badge">{statusMessage || "thinking…"}</span>
    {/if}
  </div>

  <div class="messages" bind:this={messagesEl}>
    {#each messages as msg}
      <div class="message {msg.role}">
        <div class="message-bubble" class:streaming={msg.isStreaming}>
          {#if msg.imageUrl}
            <img
              src={msg.imageUrl}
              alt="Uploaded diagram"
              class="message-image"
            />
          {/if}
          {#if msg.role === "system"}
            {msg.content}
          {:else}
            {@html renderMarkdown(msg.content)}
          {/if}
        </div>
        {#if msg.followUpSuggestions && msg.followUpSuggestions.length > 0}
          <div class="suggestion-chips">
            {#each msg.followUpSuggestions as suggestion}
              <button
                class="suggestion-chip"
                onclick={() => onSubmit(suggestion)}
                disabled={isLoading}
              >
                {suggestion}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if isLoading && !(messages.length > 0 && messages[messages.length - 1].isStreaming)}
      <div class="message assistant">
        <div class="message-bubble loading">
          <span></span><span></span><span></span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Hidden file input -->
  <input
    bind:this={fileInputEl}
    type="file"
    accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
    style="display: none"
    onchange={handleFileSelect}
  />

  <form
    class="chat-form"
    onsubmit={(e) => {
      e.preventDefault();
      sendMessage();
    }}
  >
    <div class="chat-toolbar">
      <div class="toolbar-select">
        <label for="chart-select">Chart</label>
        <select
          id="chart-select"
          value={chartType ?? ""}
          onchange={(e) => {
            const v = e.currentTarget.value;
            onChartTypeChange(v === "" ? null : v);
          }}
          disabled={isLoading}
        >
          {#each CHART_TYPES as ct}
            <option value={ct.value ?? ""}>{ct.label}</option>
          {/each}
        </select>
      </div>
    </div>

    {#if imagePreviewUrl}
      <div class="image-preview">
        <img src={imagePreviewUrl} alt="Preview" />
        <div class="image-preview-info">
          <span class="image-preview-label"
            >Image attached — AI will reproduce as Mermaid</span
          >
          <span class="image-preview-hint"
            >Add optional instructions below, then send</span
          >
        </div>
        <button
          type="button"
          class="image-preview-remove"
          onclick={clearImage}
          title="Remove image"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          >
            <line x1="1" y1="1" x2="9" y2="9" /><line
              x1="9"
              y1="1"
              x2="1"
              y2="9"
            />
          </svg>
        </button>
      </div>
    {/if}

    <textarea
      bind:value={inputText}
      onkeydown={handleKeydown}
      placeholder={pendingImage
        ? "Add instructions (optional)…"
        : "Describe a diagram or upload an image…"}
      rows="3"
      disabled={isLoading}
    ></textarea>

    <div class="chat-actions">
      <button
        type="button"
        class="upload-btn"
        onclick={triggerFileInput}
        disabled={isLoading}
        title="Upload an image to convert to Mermaid"
      >
        <svg
          width="25"
          height="25"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </button>
      {#if isLoading}
        <button
          type="button"
          class="stop-btn"
          onclick={onStop}
          title="Stop generation"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <rect x="1" y="1" width="10" height="10" rx="2" />
          </svg>
        </button>
      {:else}
        <button
          type="submit"
          id="chat-send-btn"
          disabled={!inputText.trim() && !pendingImage}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
            ><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg
          >
        </button>
      {/if}
    </div>
  </form>
</section>
