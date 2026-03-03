<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorView, basicSetup } from "codemirror";
  import { EditorState } from "@codemirror/state";
  import { mermaid } from "codemirror-lang-mermaid";
  import { oneDark } from "@codemirror/theme-one-dark";

  let {
    code,
    onCodeChange,
  }: { code: string; onCodeChange: (code: string) => void } = $props();

  let editorEl: HTMLDivElement;
  let view: EditorView | null = null;
  let isUpdatingFromParent = false;

  onMount(() => {
    const state = EditorState.create({
      doc: code,
      extensions: [
        basicSetup,
        mermaid(),
        oneDark,
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: '"JetBrains Mono", monospace',
          },
          "&.cm-editor.cm-focused": { outline: "none" },
          ".cm-content": { padding: "16px 0" },
          ".cm-line": { padding: "0 16px" },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isUpdatingFromParent) {
            onCodeChange(update.state.doc.toString());
          }
        }),
      ],
    });

    view = new EditorView({ state, parent: editorEl });
  });

  // Sync external changes (from AI) into CodeMirror without losing cursor
  $effect(() => {
    if (view && code !== view.state.doc.toString()) {
      isUpdatingFromParent = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
      });
      isUpdatingFromParent = false;
    }
  });

  onDestroy(() => view?.destroy());
</script>

<section class="panel editor-panel">
  <div class="panel-header">
    <span class="panel-icon"></span>
    <h2>Mermaid Editor</h2>
    <span class="panel-hint">Edits render live →</span>
  </div>
  <div class="editor-container" bind:this={editorEl}></div>
</section>
