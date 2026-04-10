/**
 * Lightweight markdown-to-HTML converter for chat messages.
 * Handles: paragraphs, bold, italic, inline code, code blocks, and links.
 */

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function inlineMarkdown(text: string): string {
    return (
        escapeHtml(text)
            // code spans (must come first to protect contents)
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // bold
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/__(.+?)__/g, "<strong>$1</strong>")
            // italic
            .replace(/\*(.+?)\*/g, "<em>$1</em>")
            .replace(/_(.+?)_/g, "<em>$1</em>")
            // links
            .replace(
                /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
                '<a href="$2" target="_blank" rel="noopener">$1</a>',
            )
    );
}

export function renderMarkdown(src: string): string {
    const lines = src.split("\n");
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Fenced code blocks
        if (line.trimStart().startsWith("```")) {
            const lang = line.trim().slice(3).trim();
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
                codeLines.push(escapeHtml(lines[i]));
                i++;
            }
            i++; // skip closing ```
            const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
            out.push(`<pre><code${cls}>${codeLines.join("\n")}</code></pre>`);
            continue;
        }

        // Blank line → skip (paragraph separator)
        if (line.trim() === "") {
            i++;
            continue;
        }

        // Collect a paragraph (consecutive non-blank lines)
        const para: string[] = [];
        while (i < lines.length && lines[i].trim() !== "" && !lines[i].trimStart().startsWith("```")) {
            para.push(lines[i]);
            i++;
        }
        out.push(`<p>${para.map(inlineMarkdown).join("<br>")}</p>`);
    }

    return out.join("");
}
