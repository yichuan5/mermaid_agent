"""
Tiny RAG engine for Mermaid documentation.
Uses fastembed (ONNX) for semantic embedding search.

Chunks docs by ## headings, embeds each chunk with BAAI/bge-small-en-v1.5,
and retrieves the most relevant chunks via cosine similarity.
"""

import re
import numpy as np
from pathlib import Path
from dataclasses import dataclass
from fastembed import TextEmbedding

DOCS_DIR = Path(__file__).parent.parent / "docs" / "mermaid"

MODEL_NAME = "BAAI/bge-small-en-v1.5"


@dataclass
class DocChunk:
    """A single chunk of Mermaid documentation."""
    id: str
    source: str         # e.g. "syntax/flowchart.md"
    heading: str        # e.g. "Subgraphs"
    content: str        # the actual markdown text


class MermaidRAG:
    """Lightweight retrieval engine for Mermaid documentation."""

    def __init__(self) -> None:
        self.chunks: list[DocChunk] = []
        self.embeddings: np.ndarray | None = None
        self._model: TextEmbedding | None = None
        self._built = False

    def _get_model(self) -> TextEmbedding:
        """Lazy-load the embedding model on first use."""
        if self._model is None:
            self._model = TextEmbedding(model_name=MODEL_NAME)
        return self._model

    # ── Indexing ─────────────────────────────────────────────────

    def build_index(self) -> None:
        """Load all Mermaid docs, chunk them, and compute embeddings."""
        self.chunks = []

        for md_file in sorted(DOCS_DIR.rglob("*.md")):
            rel_path = md_file.relative_to(DOCS_DIR)
            content = md_file.read_text(encoding="utf-8")

            file_chunks = self._chunk_by_headings(
                content, str(rel_path)
            )
            self.chunks.extend(file_chunks)

        # Embed all chunks
        if self.chunks:
            texts = [
                f"{chunk.heading}: {chunk.content}"
                for chunk in self.chunks
            ]
            model = self._get_model()
            self.embeddings = np.array(list(model.embed(texts)))
        else:
            self.embeddings = np.array([])

        self._built = True

        n_files = sum(1 for _ in DOCS_DIR.rglob("*.md"))
        print(f"[rag] Indexed {len(self.chunks)} chunks from {n_files} docs")

    # ── Retrieval ────────────────────────────────────────────────

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        max_tokens: int = 3000,
    ) -> list[DocChunk]:
        """Return the most relevant chunks for the given query."""
        if not self._built or not self.chunks:
            return []

        if not query.strip():
            return []

        # Embed the query
        model = self._get_model()
        query_embedding = np.array(list(model.embed([query])))[0]

        # Cosine similarity against all chunk embeddings
        # Embeddings from fastembed are already normalized, so dot product = cosine sim
        scores = self.embeddings @ query_embedding

        # Rank by score (descending)
        ranked_indices = np.argsort(scores)[::-1]

        # Collect within token budget
        result: list[DocChunk] = []
        total_words = 0
        for chunk_idx in ranked_indices[: top_k * 2]:
            chunk = self.chunks[chunk_idx]
            chunk_words = len(chunk.content.split())
            if total_words + chunk_words > max_tokens and result:
                break
            result.append(chunk)
            total_words += chunk_words
            if len(result) >= top_k:
                break

        return result

    def format_context(self, chunks: list[DocChunk]) -> str:
        """Format retrieved chunks into a string for the system prompt."""
        if not chunks:
            return ""

        sections = []
        for chunk in chunks:
            sections.append(
                f"### {chunk.heading} (from {chunk.source})\n\n{chunk.content}"
            )

        return (
            "## Relevant Mermaid Documentation\n"
            + "\n\n---\n\n".join(sections)
        )

    # ── Internal helpers ─────────────────────────────────────────

    def _chunk_by_headings(
        self, content: str, source: str
    ) -> list[DocChunk]:
        """Split markdown into chunks at ## headings."""
        chunks: list[DocChunk] = []
        lines = content.split("\n")

        current_heading = "Overview"
        current_lines: list[str] = []
        chunk_count = 0

        for line in lines:
            heading_match = re.match(r"^##\s+(.+)", line)

            if heading_match and current_lines:
                # Flush the previous chunk
                text = "\n".join(current_lines).strip()
                if len(text) > 50:  # skip tiny / empty chunks
                    chunks.append(DocChunk(
                        id=f"{source}#{chunk_count}",
                        source=source,
                        heading=current_heading,
                        content=text,
                    ))
                    chunk_count += 1

                current_heading = heading_match.group(1).strip()
                current_lines = [line]
            else:
                current_lines.append(line)

        # Flush final chunk
        text = "\n".join(current_lines).strip()
        if len(text) > 50:
            chunks.append(DocChunk(
                id=f"{source}#{chunk_count}",
                source=source,
                heading=current_heading,
                content=text,
            ))

        return chunks


# ── Singleton ────────────────────────────────────────────────────
rag = MermaidRAG()
