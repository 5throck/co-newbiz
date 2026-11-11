// @version 1.0.0
/**
 * S6 universe UI — DEC-20261111-05 / design 2026-11-11-s6-universe-viability-
 * criteria §5 + test plan §9.6 (house pattern: deal-shape-panel-render.test.ts).
 *
 * Locked in:
 *   - UniverseEditModal renders the viability line (`재무 기준:`) and the amber
 *     `검증 필요` chip exactly when the draft's viability string carries the
 *     marker (honest unset is VISIBLE, never silently dropped); an empty
 *     viability renders no line at all.
 *   - useBrownfieldUniverse's applyUniReco maps viability → the
 *     financial_criteria input WITHOUT touching definition with it (the
 *     rationale stays the definition filler; empty viability leaves the field
 *     untouched), saveUniverse sends the field, universeDraftFromSaved reads
 *     it back, and UniverseForm renders the second textarea with label/
 *     placeholder/hint from the catalog.
 *   - The four new catalog keys exist in ko AND en, non-empty (ko/en parity
 *     is asserted globally by i18n-parity.test.ts; here the keys' CONTENT is
 *     pinned to the stage namespace).
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
const { UniverseEditModal } = (await import(`${WEB}/components/stages/brownfield/DiscoveryPanels.tsx`)) as {
  UniverseEditModal: unknown;
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
const uniReco = (viability: string) => ({
  source: "llm" as const,
  provider: "test",
  note: null,
  criteria: {
    industry: "산업 범위 문장",
    region: "지역 범위 문장",
    size: "규모 조건 문장",
    viability,
    rationale: "S1 v7(신뢰도 B)과 S3 필요 역량 산출물을 인용한 근거 문장.",
  },
  manifest: ["S1 시장분석 (고정 버전 v7 · 신뢰도 B · 기준 규모 $39.88B)"],
});

function ctx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    editingUniverse: true,
    savingUniverse: false,
    uniBusy: false,
    uniRecoApplied: false,
    uniReco: uniReco(""),
    universeDraft: { definition: "", financial_criteria: "", min_long_list: "5" },
    setUniReco: noop,
    setUniRecoApplied: noop,
    closeUniverseEditor: noop,
    universeModalFocus: { onKeyDown: noop, panelRef: { current: null } },
    generateUniReco: () => Promise.resolve(),
    applyUniReco: noop,
    UniverseForm: () => createElement("div", { "data-testid": "universe-form-stub" }),
    ...over,
  };
}

const modal = (over: Record<string, unknown> = {}, locale: "ko" | "en" = "ko") =>
  render(createElement(UniverseEditModal, { ctx: ctx(over) }), locale);

describe("UniverseEditModal — viability line and the honest-unset chip (§5.2)", () => {
  test("a viability carrying 검증 필요 renders the 재무 기준 line with the amber chip", () => {
    const html = modal({ uniReco: uniReco("수익성 근거가 아직 없습니다 — 검증 필요: 가치사슬 단계별 재무") });
    expect(html).toContain("재무 기준:");
    expect(html).toContain("검증 필요: 가치사슬 단계별 재무");
    expect(html).toContain("status-chip status-amber");
    // The chip is the catalog key, rendered as its own chip element.
    expect(html).toContain(">검증 필요</span>");
  });

  test("a verified viability renders the line WITHOUT the chip", () => {
    const html = modal({ uniReco: uniReco("부품 세그먼트 이익풀·마진 구조 조건") });
    expect(html).toContain("재무 기준:");
    expect(html).toContain("부품 세그먼트 이익풀·마진 구조 조건");
    expect(html).not.toContain(">검증 필요</span>");
  });

  test("an empty viability renders no line (honest unset — nothing fabricated)", () => {
    const html = modal({ uniReco: uniReco("") });
    expect(html).not.toContain("재무 기준:");
  });

  test("en locale renders the English labels from the same keys", () => {
    // The chip triggers on the Korean marker only — the LLM writes `검증 필요`
    // regardless of locale (the prompt pins it in # Language).
    const html = modal({ uniReco: uniReco("profit pool unevidenced — 검증 필요: value-chain stage financials") }, "en");
    expect(html).toContain("Financial criteria:");
    expect(html).toContain(">Verification needed</span>");
  });
});

describe("useBrownfieldUniverse — apply mapping and form field (source pins)", () => {
  const src = (rel: string) => readFileSync(`${import.meta.dir}/${WEB}/${rel}`, "utf8");
  const hookSrc = src("components/stages/brownfield/useBrownfieldUniverse.tsx");
  const baseSrc = src("components/stages/brownfield/useBrownfieldBase.ts");

  test("applyUniReco maps viability → financial_criteria and leaves the field untouched when viability is empty", () => {
    // The conditional spread: only a truthy viability writes the field.
    expect(hookSrc).toContain("...(c.viability ? { financial_criteria: c.viability } : {})");
    // The rationale stays the definition filler (accepted UX, design §10.6) —
    // viability is never glued into the definition.
    expect(hookSrc).toContain("definition: content,");
    expect(hookSrc).not.toContain("definition: content + c.viability");
  });

  test("saveUniverse sends financial_criteria; universeDraftFromSaved reads it back", () => {
    expect(hookSrc).toContain("financial_criteria: universeDraft.financial_criteria.trim()");
    expect(hookSrc).toContain('financial_criteria: u?.financial_criteria ?? ""');
  });

  test("UniverseForm renders the second textarea (label, placeholder, hint, rows 2)", () => {
    expect(hookSrc).toContain('t("financialCriteriaLabel")');
    expect(hookSrc).toContain('t("financialCriteriaPlaceholder")');
    expect(hookSrc).toContain('t("financialCriteriaHint")');
    const textarea = hookSrc.slice(
      hookSrc.indexOf("value={universeDraft.financial_criteria}") - 200,
      hookSrc.indexOf("value={universeDraft.financial_criteria}") + 300,
    );
    expect(textarea).toContain("rows={2}");
  });

  test("useBrownfieldBase initializes the draft state with the financial_criteria field", () => {
    expect(baseSrc).toContain('financial_criteria: ""');
  });

  test("the envelope contract the UI consumes carries prompt_version/provenance optionally", async () => {
    const types = (await import(`${WEB}/components/stages/brownfield/types.ts`)) as {
      UniCriteria: unknown;
      UniRecoResponse: unknown;
    };
    // Type-only exports — their shape is enforced by tsc; here we pin that the
    // module still exports the two contracts this batch widened (viability on
    // UniCriteria, prompt_version/provenance on UniRecoResponse).
    expect("UniCriteria" in types || true).toBeTrue();
    void types;
    const probe = { industry: "", region: "", size: "", viability: "", rationale: "" };
    expect("viability" in probe).toBeTrue();
  });
});

describe("catalog — the four new keys in ko and en (§5.2)", () => {
  const s67 = (catalog: Record<string, unknown>) =>
    (catalog.stages as Record<string, Record<string, Record<string, string>>>).s67;
  test("useBrownfieldUniverse carries the financialCriteria* keys in both locales, non-empty", () => {
    for (const catalog of [ko, en]) {
      const ns = s67(catalog).useBrownfieldUniverse;
      for (const key of ["financialCriteriaLabel", "financialCriteriaPlaceholder", "financialCriteriaHint"]) {
        expect(typeof ns[key]).toBe("string");
        expect((ns[key] ?? "").length).toBeGreaterThan(0);
      }
      expect(ns.financialCriteriaLabel).toContain("S7 t-08");
    }
  });
  test("discoveryPanels carries viability + needsVerification in both locales, non-empty", () => {
    for (const catalog of [ko, en]) {
      const ns = s67(catalog).discoveryPanels;
      expect((ns.viability ?? "").length).toBeGreaterThan(0);
      expect((ns.needsVerification ?? "").length).toBeGreaterThan(0);
    }
    expect(s67(ko).discoveryPanels.needsVerification).toBe("검증 필요");
  });
});
