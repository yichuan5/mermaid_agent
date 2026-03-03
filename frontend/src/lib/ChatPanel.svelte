<script lang="ts">
  import { tick } from "svelte";
  import type { Message } from "$lib/types";

  let {
    messages,
    isLoading,
    onSubmit,
  }: {
    messages: Message[];
    isLoading: boolean;
    onSubmit: (text: string) => void;
  } = $props();

  let inputText = $state("");
  let messagesEl: HTMLDivElement;

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
    if (!text || isLoading) return;
    inputText = "";
    onSubmit(text);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
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

  <form
    class="chat-form"
    onsubmit={(e) => {
      e.preventDefault();
      sendMessage();
    }}
  >
    <textarea
      bind:value={inputText}
      onkeydown={handleKeydown}
      placeholder="Describe a diagram… (Enter to send)"
      rows="3"
      disabled={isLoading}
    ></textarea>
    <button
      type="submit"
      id="chat-send-btn"
      disabled={isLoading || !inputText.trim()}
    >
      {isLoading ? "Loading" : "Send"}
    </button>
  </form>
</section>
