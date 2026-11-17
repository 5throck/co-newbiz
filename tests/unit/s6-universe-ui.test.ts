// @version 1.0.0
/**
 * S6 universe form — DEC-20261111-05 / design 2026-11-11-s6-universe-viability-
 * criteria §5 (`재무 기준` input) as carried through the direction review
 * (design 2026-11-17-s6-universe-direction-review, whose card, modal preview and
 * label rename tests live in s6-universe-direction-ui.test.ts).
 *
 * Locked in:
 *   - the save payload sends financial_criteria, the saved draft reads it back,
 *     and the form renders the second textarea with label/placeholder/hint from
 *     the catalog (honest unset: an AI draft never fills it).
 *   - the four catalog keys exist in ko AND en, non-empty (ko/en parity is
 *     asserted globally by i18n-parity.test.ts; here the keys' CONTENT is pinned
 *     to the stage namespace).
 */
import { describe, expect, test } from "bun:test";

const WEB = "../../app/web-next";
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const { readFileSync } = require("node:fs") as typeof import("node:fs");

describe("useBrownfieldUniverse — form field and save (source pins)", () => {
  const src = (rel: string) => readFileSync(`${import.meta.dir}/${WEB}/${rel}`, "utf8");
  const hookSrc = src("components/stages/brownfield/useBrownfieldUniverse.tsx");
  const draftSrc = src("components/stages/brownfield/universeDraft.ts");
  const baseSrc = src("components/stages/brownfield/useBrownfieldBase.ts");

  test("the save payload still sends financial_criteria; the saved draft reads it back", () => {
    // The payload is built by savePayload (universeDraft.ts) since the direction review
    // (design 2026-11-17 §5.4); applying a draft no longer maps viability anywhere.
    expect(hookSrc).toContain("savePayload(universeDraft)");
    expect(draftSrc).toContain("financial_criteria: draft.financial_criteria.trim()");
    expect(draftSrc).toContain('financial_criteria: u?.financial_criteria ?? ""');
    expect(hookSrc).not.toContain("c.viability");
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

  test("useBrownfieldBase initializes the draft state through emptyUniverseDraft (financial_criteria empty)", () => {
    expect(baseSrc).toContain("useState<UniverseDraft>(emptyUniverseDraft())");
    expect(draftSrc).toContain('financial_criteria: ""');
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
      expect(ns.financialCriteriaLabel).toContain("S7");
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
