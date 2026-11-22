// U1 — design 2026-11-21-s67-completion-visibility § Defect Remediation: the brief-mismatch
// caption in GateBriefBody resolved the internal gate id verbatim ("브리프는 pre_fs 기준입니다").
// The fix renders ONE keyed message (components.gateDecision.panel.briefGateMismatch) whose
// {gate} param is the catalog label (GATE_LABEL_KEY → common.gate.*), never the raw id —
// the render-pins below sweep every id in GATE_LABEL_KEY for ko and en and assert the exact
// copy, plus catalog parity (new key present, the two retired keys removed).
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
const { GATE_LABEL_KEY } = (await import(`${WEB}/lib/label-keys.ts`)) as { GATE_LABEL_KEY: Record<string, string> };
const { GateBriefBody } = (await import(`${WEB}/components/GateDecisionPanel.tsx`)) as {
  GateBriefBody: unknown;
};

const localeOf = (catalog: Record<string, unknown>, key: string): string => {
  const v = key
    .split(".")
    .reduce<unknown>(
      (acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      catalog,
    );
  if (typeof v !== "string") throw new Error(`catalog key not found: ${key}`);
  return v;
};

const briefData = (gate: string) => ({
  brief_id: "br1",
  source: "synthesis" as const,
  provider: null,
  note: null,
  manifest: ["stage:S6"],
  gate,
  brief: {
    recommendation: "go" as const,
    confidence: "medium",
    rationale_draft: "근거 초안",
    key_evidence: [] as string[],
    cautions: [] as string[],
  },
});

const render = (gate: string, currentGate: string, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      createElement(GateBriefBody, { briefData: briefData(gate), currentGate, onApply: () => {} }),
    ),
  );

// Raw-id substrings that must never appear: ids with underscores cannot collide with CSS class
// text (the design's acceptance list is pre_fs/target_screening/entity_ic; group_ic shares the
// property). Short ids ("fs", "dd") are excluded — they collide with classes like --fs-caption.
const RAW_IDS = ["pre_fs", "target_screening", "entity_ic", "group_ic"];

describe("GateBriefBody brief-mismatch caption (U1)", () => {
  test("every gate id renders the catalog label — never the raw id (ko)", () => {
    for (const g of Object.keys(GATE_LABEL_KEY)) {
      const currentGate = g === "fs" ? "dd" : "fs"; // always a mismatch so the caption renders
      const html = render(g, currentGate);
      const label = localeOf(ko, GATE_LABEL_KEY[g]);
      expect(html).toContain(label);
      for (const raw of RAW_IDS) expect(html).not.toContain(raw);
    }
  });

  test("every gate id renders the catalog label — never the raw id (en)", () => {
    for (const g of Object.keys(GATE_LABEL_KEY)) {
      const currentGate = g === "fs" ? "dd" : "fs";
      const html = render(g, currentGate, "en");
      const label = localeOf(en, GATE_LABEL_KEY[g]);
      expect(html).toContain(label);
      for (const raw of RAW_IDS) expect(html).not.toContain(raw);
    }
  });

  test("Pre-FS mismatch caption reads the exact ko copy of the design table", () => {
    const html = render("pre_fs", "fs");
    expect(html).toContain("이 브리프는 예비타당성 검토(Pre-FS) 기준입니다 — 진행을 바꾸면 재생성하세요.");
  });

  test("en caption carries the same message shape with the en label", () => {
    const html = render("pre_fs", "fs", "en");
    expect(html).toContain(
      "This brief targets Preliminary feasibility study (Pre-FS) — regenerate it after changing the gate.",
    );
  });

  test("matching gate: no mismatch caption at all", () => {
    for (const locale of ["ko", "en"] as const) {
      const html = render("pre_fs", "pre_fs", locale);
      expect(html).not.toContain("기준입니다");
      expect(html).not.toContain("This brief targets");
    }
  });

  test("catalog parity: briefGateMismatch in both locales, the two retired keys gone from both", () => {
    for (const catalog of [ko, en]) {
      const panel = (catalog.components as Record<string, unknown>).gateDecision as Record<string, unknown>;
      const p = panel.panel as Record<string, unknown>;
      expect(typeof p.briefGateMismatch).toBe("string");
      expect(p.briefGateMismatch).toContain("{gate}");
      expect("theBrief" in p).toBe(false);
      expect("isTheBasisRegenerateAfter" in p).toBe(false);
    }
  });
});
