// @version 1.0.0
/**
 * markdown-preview — a deliberately small markdown → safe-HTML renderer for the
 * report editor's preview panel (2026-11-21 scope: the composer's own markdown
 * only). Text is HTML-ESCAPED FIRST, then a whitelist of constructs is turned
 * into tags on the escaped text, so injected HTML/script can never survive:
 * headings (#..######), hr (---), blockquote (>), unordered/ordered lists,
 * bold (**x**), italic (*x*), inline code (`x`), and paragraphs.
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline pass — runs on ALREADY-escaped text. */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

export function markdownToHtml(md: string): string {
  const lines = escapeHtml(md ?? "").split(/\r?\n/);
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (/^(---+|\*\*\*+)$/.test(line)) { closeList(); out.push("<hr>"); continue; }
    if (heading) { closeList(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    if (ul) { if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(ul[1])}</li>`); continue; }
    if (ol) { if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(ol[1])}</li>`); continue; }
    if (line.startsWith("&gt; ")) { closeList(); out.push(`<blockquote>${inline(line.slice(5))}</blockquote>`); continue; }
    if (line.trim() === "") { closeList(); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}
