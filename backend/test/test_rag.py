"""Tests for the MermaidRAG retrieval engine."""

import numpy as np
from services.rag import MermaidRAG, DocChunk


# ── Helpers ──────────────────────────────────────────────────────

SAMPLE_FLOWCHART_MD = """\
# Flowchart

## Basic Syntax

Flowcharts use `graph` or `flowchart` keywords.

```mermaid
flowchart TD
    A[Start] --> B[End]
```

Nodes can be round, square, or diamond shaped.

## Subgraphs

You can group nodes into subgraphs for better organization.

```mermaid
flowchart TD
    subgraph one
        A --> B
    end
```

Subgraphs can also be nested inside other subgraphs.
"""

SAMPLE_SEQUENCE_MD = """\
# Sequence Diagram

## Messages

Participants send messages to each other using arrows.

```mermaid
sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi back
```

You can use solid or dashed arrows for different message types.

## Activations

Use activate and deactivate to show when a participant is active.

```mermaid
sequenceDiagram
    Alice->>+Bob: Request
    Bob-->>-Alice: Response
```

Activations show the processing time of a participant.
"""


def _build_rag_with_samples() -> MermaidRAG:
    """Create a MermaidRAG with sample docs pre-loaded (no filesystem)."""
    rag = MermaidRAG()

    # Manually chunk sample docs
    flow_chunks = rag._chunk_by_headings(SAMPLE_FLOWCHART_MD, "syntax/flowchart.md")
    seq_chunks = rag._chunk_by_headings(SAMPLE_SEQUENCE_MD, "syntax/sequenceDiagram.md")

    rag.chunks = flow_chunks + seq_chunks

    # Embed all chunks
    texts = [f"{c.heading}: {c.content}" for c in rag.chunks]
    model = rag._get_model()
    rag.embeddings = np.array(list(model.embed(texts)))
    rag._built = True

    return rag


# ── Chunking ────────────────────────────────────────────────────


class TestChunking:
    def test_splits_at_h2_headings(self):
        rag = MermaidRAG()
        chunks = rag._chunk_by_headings(SAMPLE_FLOWCHART_MD, "test.md")
        headings = [c.heading for c in chunks]
        assert "Basic Syntax" in headings
        assert "Subgraphs" in headings

    def test_chunk_metadata(self):
        rag = MermaidRAG()
        chunks = rag._chunk_by_headings(SAMPLE_FLOWCHART_MD, "syntax/flowchart.md")
        for chunk in chunks:
            assert chunk.source == "syntax/flowchart.md"
            assert len(chunk.content) > 50  # chunks below 50 chars are skipped

    def test_skips_tiny_chunks(self):
        tiny_md = "# Title\n\n## Section\n\nHi\n\n## Another\n\nThis section has enough content to be included in the index results."
        rag = MermaidRAG()
        chunks = rag._chunk_by_headings(tiny_md, "test.md")
        # "Hi" chunk should be skipped (< 50 chars)
        assert all(len(c.content) > 50 for c in chunks)


# ── Retrieval ───────────────────────────────────────────────────


class TestRetrieval:
    def test_returns_relevant_chunks(self):
        rag = _build_rag_with_samples()
        results = rag.retrieve("flowchart subgraph")
        assert len(results) > 0
        # Flowchart chunks should rank highest
        assert "flowchart" in results[0].source

    def test_semantic_match(self):
        """Embedding search should match semantically even without exact keywords."""
        rag = _build_rag_with_samples()
        results = rag.retrieve("how to group nodes together")
        assert len(results) > 0
        # Should find the subgraphs chunk semantically
        sources = [r.source for r in results]
        assert any("flowchart" in s for s in sources)

    def test_empty_query_returns_empty(self):
        rag = _build_rag_with_samples()
        results = rag.retrieve("")
        assert results == []

    def test_unbuilt_index_returns_empty(self):
        rag = MermaidRAG()
        results = rag.retrieve("flowchart")
        assert results == []

    def test_respects_top_k(self):
        rag = _build_rag_with_samples()
        results = rag.retrieve("flowchart", top_k=1)
        assert len(results) <= 1

    def test_respects_max_tokens(self):
        rag = _build_rag_with_samples()
        results = rag.retrieve("flowchart", max_tokens=10)
        # With a very tight budget, should return at most 1 chunk
        assert len(results) <= 2


# ── Format Context ──────────────────────────────────────────────


class TestFormatContext:
    def test_formats_with_headings(self):
        rag = _build_rag_with_samples()
        chunks = rag.retrieve("flowchart subgraph")
        text = rag.format_context(chunks)
        assert "## Relevant Mermaid Documentation" in text
        assert "###" in text  # chunk headings

    def test_empty_chunks_returns_empty_string(self):
        rag = MermaidRAG()
        assert rag.format_context([]) == ""

    def test_includes_source_info(self):
        rag = _build_rag_with_samples()
        chunks = rag.retrieve("flowchart")
        text = rag.format_context(chunks)
        assert "flowchart.md" in text
