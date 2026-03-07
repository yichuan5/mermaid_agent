<script lang="ts">
  import { tick } from "svelte";
  import type { Message } from "$lib/types";

  let {
    messages,
    isLoading,
    onSubmit,
    onImageUpload,
  }: {
    messages: Message[];
    isLoading: boolean;
    onSubmit: (text: string) => void;
    onImageUpload: (file: File, message: string) => void;
  } = $props();

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
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      alert("Please upload a PNG, JPEG, WebP, or GIF image.");
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
    <span class="panel-icon"></span>
    <h2>AI Assistant</h2>
    {#if isLoading}
      <span class="thinking-badge">thinking…</span>
    {/if}
  </div>

  <div class="messages" bind:this={messagesEl}>
    {#each messages as msg}
      <div class="message {msg.role}">
        <div class="message-bubble">
          {#if msg.imageUrl}
            <img
              src={msg.imageUrl}
              alt="Uploaded diagram"
              class="message-image"
            />
          {/if}
          {msg.content}
        </div>
      </div>
    {/each}
    {#if isLoading}
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
    accept="image/png,image/jpeg,image/webp,image/gif"
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
        ? "Add instructions (optional)… then press Enter"
        : "Describe a diagram… (Enter to send)"}
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
          width="18"
          height="18"
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
      <button
        type="submit"
        id="chat-send-btn"
        disabled={isLoading || (!inputText.trim() && !pendingImage)}
      >
        {#if isLoading}
          <svg
            class="spin"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"><path d="M12 2a10 10 0 0 1 10 10" /></svg
          >
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
            ><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg
          >
        {/if}
      </button>
    </div>
  </form>
</section>
