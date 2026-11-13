// @version 1.0.0
/**
 * WebDiscoveryPanel — the one-ignore chip and the persisted ignore wiring
 * (design 2026-11-13-proposal-ignore-suppression §3.5 + test plan §7, house
 * pattern: s6-universe-ui.test.ts renderToStaticMarkup under
 * NextIntlClientProvider).
 *
 * Locked in:
 *   - a suggestion with ignore_count >= 1 renders the text chip "무시 1회"
 *     (ko) / "Ignored 1 time(s)" (en) — status by TEXT, never color alone
 *     (§9); undefined ignore_count renders no chip; the payload never
 *     reaches 2 (the server suppresses at 2, so the chip shows 1 at most).
 *   - the 무시 button calls the injected ignoreProposal — the inline
 *     in-memory filter is gone from the click handler; useBrownfieldBase
 *     persists FIRST (POST) and removes the card only on success, so a
 *     failed persist keeps the card and surfaces the error (§3.5).
 *   - locale keys present in both en.json and ko.json, non-empty (§5.9).
 */
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
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const { WebDiscoveryPanel } = (await import(`${WEB}/components/stages/brownfield/DiscoveryPanels.tsx`)) as {
  WebDiscoveryPanel: unknown;
};
const { readFileSync } = require("node:fs") as typeof import("node:fs");

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      el,
    ),
  );

const noop = () => {};
const suggestion = (over: Record<string, unknown> = {}) => ({
  company_name: "한양",
  dart_corp_code: null,
  rationale: "검색 근거 요약",
  sources: [],
  reliability: "C" as const,
  ...over,
});

function ctx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    selected: { opportunity: { id: "opp-1", name: "렌더 핀 기회" } },
    discoveryPanel: "web",
    webBusy: false,
    setDiscoveryPanel: noop,
    webModalFocus: { onKeyDown: noop, panelRef: { current: null } },
    webProposals: [suggestion()],
    webNote: null,
    webSource: "llm",
    acceptProposal: () => Promise.resolve(),
    ignoreProposal: () => Promise.resolve(),
    setWebProposals: noop,
    generateWebProposals: () => Promise.resolve(),
    ...over,
  };
}

/** React SSR separates adjacent text nodes with comment markers — strip them
 *  so the interpolated chip text can be asserted as one string. */
const text = (html: string) => html.replace(/<!-- -->/g, "");

const panel = (over: Record<string, unknown> = {}, locale: "ko" | "en" = "ko") =>
  text(render(createElement(WebDiscoveryPanel, { ctx: ctx(over) }), locale));

describe("WebDiscoveryPanel — the one-ignore chip (§3.5, §5.9)", () => {
  test("ignore_count: 1 renders the text chip 무시 1회 beside the confidence chip", () => {
    const html = panel({ webProposals: [suggestion({ ignore_count: 1 })] });
    expect(html).toContain("무시 1회");
    expect(html).toContain("status-chip"); // chip styling pair, text carries the status
    expect(html).toContain("신뢰도"); // the existing confidence chip is untouched
  });

  test("ignore_count undefined renders NO chip (0 events → field absent)", () => {
    const html = panel({ webProposals: [suggestion()] });
    expect(html).not.toContain("무시 1회"); // the button label is 무시 — the CHIP text is the signal
    expect(html).toContain("한양"); // the card itself is there
  });

  test("en locale renders the English text from the same key", () => {
    const html = panel({ webProposals: [suggestion({ ignore_count: 1 })] }, "en");
    expect(html).toContain("Ignored 1 time(s)");
    expect(html).not.toContain("무시");
  });

  test("the chip text carries the count (the payload never reaches 2 — the server suppresses)", () => {
    const html = panel({ webProposals: [suggestion({ ignore_count: 1 })] });
    expect(html).toContain("무시 1회");
    expect(html).not.toContain("무시 2회");
  });
});

describe("ignore wiring — persist first, then remove (§3.5 source pins)", () => {
  const src = (rel: string) => readFileSync(`${import.meta.dir}/${WEB}/${rel}`, "utf8");
  const panelsSrc = src("components/stages/brownfield/DiscoveryPanels.tsx");
  const baseSrc = src("components/stages/brownfield/useBrownfieldBase.ts");

  test("the 무시 button calls the injected ignoreProposal — the inline filter is gone from the click handler", () => {
    expect(panelsSrc).toContain("void ignoreProposal(s.company_name)");
    expect(panelsSrc).not.toContain("filter((p) => p.company_name !== s.company_name)");
  });

  test("useBrownfieldBase persists FIRST and removes the card only after the POST succeeds", () => {
    const fn = baseSrc.slice(
      baseSrc.indexOf("async function ignoreProposal"),
      baseSrc.indexOf("async function ignoreProposal") + 900,
    );
    expect(fn).toContain("api.post(`/api/brownfield/");
    expect(fn).toContain("target-proposals/ignore`");
    expect(fn.indexOf("api.post(")).toBeLessThan(fn.indexOf("setWebProposals((prev)")); // persist → then remove
    // the removal sits INSIDE the try block (after await), the error path only sets error text
    expect(fn).toMatch(/await api\.post[\s\S]*setWebProposals\(\(prev\) => \(prev \?\? \[\]\)\.filter/);
    expect(fn).toContain("setError(err instanceof Error");
    expect(fn).not.toContain("finally"); // a failed persist must not remove the card
  });

  test("WebSuggestion carries the additive ignore_count (old responses still consumed)", async () => {
    const types = (await import(`${WEB}/components/stages/brownfield/types.ts`)) as {
      WebSuggestion?: unknown;
    };
    void types; // shape enforced by tsc — the additive optional field is a compile-time pin
    expect(baseSrc).toContain("/target-proposals/ignore`"); // the ignore route call exists in the hook
    expect(baseSrc).toContain("ignoreProposal,"); // exported through the ctx type
  });
});

describe("catalog — ignoredCountChip + failedToIgnore in ko and en (§5.9)", () => {
  const s67 = (catalog: Record<string, unknown>) =>
    (catalog.stages as Record<string, Record<string, Record<string, string>>>).s67;
  test("both keys exist in both locales, non-empty, with the count placeholder on the chip", () => {
    for (const catalog of [ko, en]) {
      const panels = s67(catalog).discoveryPanels;
      const base = s67(catalog).useBrownfieldBase;
      expect((panels.ignoredCountChip ?? "").length).toBeGreaterThan(0);
      expect(panels.ignoredCountChip).toContain("{count}");
      expect((base.failedToIgnore ?? "").length).toBeGreaterThan(0);
    }
    expect(s67(ko).discoveryPanels.ignoredCountChip).toBe("무시 {count}회");
    expect(s67(en).discoveryPanels.ignoredCountChip).toBe("Ignored {count} time(s)");
  });
});
