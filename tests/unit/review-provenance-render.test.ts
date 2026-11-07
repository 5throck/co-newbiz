// Design 2026-11-07-review-internal-items: the provenance disclosure renders collapsed, with a count in text,
// plain-language entries per code, the original LLM text nested for filtered items, and nothing when empty.
import { describe, expect, test } from "bun:test";

const WEB = "../../app/web-next";
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as {
  renderToStaticMarkup: (el: unknown) => string;
};
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as {
  createElement: (type: unknown, props: unknown, ...c: unknown[]) => unknown;
};
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as {
  NextIntlClientProvider: unknown;
};
const ko = (await import(`${WEB}/locales/ko.json`)).default as { review: { provenance: Record<string, string> } };
const en = (await import(`${WEB}/locales/en.json`)).default as { review: { provenance: Record<string, string> } };
const { ReviewProvenance } = (await import(`${WEB}/components/ReviewProvenance.tsx`)) as { ReviewProvenance: unknown };

const render = (items: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      createElement(ReviewProvenance, { items }),
    ),
  );

const items = [
  {
    code: "fallback_reviewer",
    params: {
      fallbackReason: "reviewer domain unresolved",
      reviewerAgent: "platform-lead",
      specialist: "frontend-engineer",
    },
  },
  { code: "orchestrator_exempt", params: { agents: "pm", legacy: true } },
  { code: "unresolved_agent", params: { agents: "mystery-agent" } },
  {
    code: "filtered_internal_item",
    params: { bucket: "needs_judgement", claim: "entity_id 01M6 track is null", reason: "Allow the gate to proceed?" },
  },
];

describe("ReviewProvenance", () => {
  test("renders nothing for an empty or missing list", () => {
    expect(render([])).toBe("");
    expect(render(undefined)).toBe("");
  });

  test("ko: collapsed native details with the count in the summary text", () => {
    const html = render(items);
    const d = html.match(/<details[^>]*data-testid="review-provenance"[\s\S]*?<\/details>/)![0];
    expect(d).not.toContain("open=");
    expect(d).toContain("<summary>검토 경위 (4)</summary>");
    expect(d).toContain("세 묶음의 건수에는 들어가지 않으며");
  });

  test("ko: each code reads as plain language, no raw code or template tokens leak", () => {
    const html = render(items);
    expect(html).toContain("기본 교차 도메인 검토자(platform-lead)가 대신 검토했습니다");
    expect(html).toContain("작성 에이전트의 도메인을 확인하지 못해 검토자를 정하지 못했습니다");
    expect(html).toContain("해당 분야 전문 에이전트(frontend-engineer)");
    expect(html).toContain("조율 역할 에이전트(pm)");
    expect(html).toContain("이전 검토 기록에서 옮겨 온 항목입니다");
    expect(html).toContain("도메인을 확인하지 못한 작성 에이전트(mystery-agent)");
    expect(html).toContain("내부 식별자·시스템 필드만 다룬 AI 항목을 의사결정 항목에서 뺐습니다");
    expect(html).not.toContain("{");
    expect(html).not.toContain("review.provenance");
  });

  test("filtered item keeps the original text in a nested muted line, labelled with its bucket", () => {
    const html = render(items);
    const orig = html.match(/<span[^>]*data-testid="review-provenance-original"[^>]*>([\s\S]*?)<\/span>/)!;
    expect(orig[0]).toContain("text-[color:var(--muted-fg)]");
    expect(orig[1]).toContain("entity_id 01M6 track is null — Allow the gate to proceed?");
    expect(orig[1]).toContain("판단 필요");
  });

  test("en: English wording, fallback reason stays the stored English template", () => {
    const html = render(items, "en");
    expect(html).toContain("<summary>Review provenance (4)</summary>");
    expect(html).toContain(
      "default cross-domain reviewer (platform-lead) reviewed instead. Reason: reviewer domain unresolved",
    );
    expect(html).toContain("The coordinating agent (pm)");
    expect(html).not.toContain("review.provenance");
  });

  test("unknown code and null params degrade to text, never throw", () => {
    const html = render([
      { code: "future_code", params: {} },
      { code: "orchestrator_exempt", params: { agents: null } },
    ]);
    expect(html).toContain("알 수 없는 검토 경위 항목입니다 (future_code)");
    expect(html).toContain("조율 역할 에이전트(확인되지 않음)");
  });

  test("ko and en catalogs define the same provenance keys", () => {
    expect(Object.keys(ko.review.provenance).sort()).toEqual(Object.keys(en.review.provenance).sort());
  });
});
