// markdown-preview (2026-10-21) — the report editor's preview renderer.
// Contract: HTML-escape FIRST, then whitelist constructs on the escaped text —
// injected markup can never survive. Supported: headings, hr, blockquote,
// ul/ol, bold, italic, inline code, paragraphs.
import { describe, expect, test } from "bun:test";
import { markdownToHtml } from "../../app/web-next/lib/markdown-preview.ts";

describe("markdownToHtml", () => {
  test("headings, bold, italic, inline code, lists, hr, blockquote", () => {
    const html = markdownToHtml("# 제목\n\n## 하위\n\n- 항목 **굵게**\n- 항목2 `코드`\n\n1. 첫\n2. 둘\n\n> 인용\n\n---\n\n본문 *강조* 문단");
    expect(html).toContain("<h1>제목</h1>");
    expect(html).toContain("<h2>하위</h2>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>항목 <strong>굵게</strong></li>");
    expect(html).toContain("<li>항목2 <code>코드</code></li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>첫</li>");
    expect(html).toContain("<li>둘</li>");
    expect(html).toContain("<blockquote>인용</blockquote>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<p>본문 <em>강조</em> 문단</p>");
  });

  test("injected HTML is escaped and never rendered", () => {
    const html = markdownToHtml('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n**<b>굵게</b>**');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>굵게</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>&lt;b&gt;굵게&lt;/b&gt;</strong>");
  });

  test("blank lines close lists; paragraphs pass through", () => {
    const html = markdownToHtml("- a\n\n- b");
    expect((html.match(/<ul>/g) ?? []).length).toBe(2); // each item gets its own list
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<li>b</li>");
  });
});
