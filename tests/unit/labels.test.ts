import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";
import {
  localizeRequirement, UNCLASSIFIED_LABEL, dedupTermNames, labelText, localizeMessage, resolveLabel,
} from "../../app/web-next/lib/labels.ts";
import {
  DECISION_MODE_LABEL_KEY, DECISION_LABEL_KEY, GATE_LABEL_KEY, RAG_DIMENSION_KEY, RAG_DIMENSION_ORDER,
  RECORD_KEY, STAGE_STATUS_KEY, SUB_TRACK_KEY, TRACK_KEY, TRANSITION_DECISION_KEY, trackKeyParts, trackKeysText, resolveLabelTokens,
} from "../../app/web-next/lib/label-keys.ts";

// i18n re-pin (T3-6): the vocabulary moved from lib/labels.ts Korean maps to `common.*`
// catalog keys pinned in lib/label-keys.ts — resolved here through a ko stub ROOT translator.
const ko = JSON.parse(readFileSync("app/web-next/locales/ko.json", "utf8")) as Record<string, any>;
const tr = (key: string): string => key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, any>)[k], ko) as string;

const KEY_MAPS: Record<string, Record<string, string>> = {
  GATE_LABEL_KEY, TRACK_KEY, SUB_TRACK_KEY, STAGE_STATUS_KEY, DECISION_MODE_LABEL_KEY,
  TRANSITION_DECISION_KEY, RAG_DIMENSION_KEY, RECORD_KEY,
};

describe("label key maps", () => {
  for (const [name, map] of Object.entries(KEY_MAPS)) {
    test(`${name}: every key resolves to non-empty Korean that is not the raw key`, () => {
      expect(Object.keys(map).length).toBeGreaterThan(0);
      for (const [k, key] of Object.entries(map)) {
        const v = tr(key);
        expect(v.trim().length).toBeGreaterThan(0);
        expect(v).not.toBe(k);
        // Hangul required, except established Latin deal terms (M&A); never a pure snake_case echo.
        if (!["M&A"].includes(v)) expect(/[가-힣]/.test(v)).toBe(true);
        expect(/^[a-z]+(_[a-z]+)+$/.test(v)).toBe(false);
      }
    });
  }

  test("required keys from the design are all present", () => {
    for (const k of ["screening", "pre_fs", "target_screening", "entity_ic", "group_ic", "fs", "dd"]) expect(GATE_LABEL_KEY[k]).toBeTruthy();
    for (const k of ["hybrid", "agent_team", "human_only"]) expect(DECISION_MODE_LABEL_KEY[k]).toBeTruthy();
    for (const k of ["graduate_to_core", "reduce_or_divest", "kill_with_learning_captured", "next_tranche_released", "held_evidence_incomplete"])
      expect(TRANSITION_DECISION_KEY[k]).toBeTruthy();
    for (const k of ["existing_business_rbd", "partnership", "m_and_a"]) expect(SUB_TRACK_KEY[k]).toBeTruthy();
    expect(STAGE_STATUS_KEY.in_progress).toBeTruthy();
    expect(Object.keys(RAG_DIMENSION_KEY).sort()).toEqual([...RAG_DIMENSION_ORDER].sort());
  });

  test("localizeMessage uses the transition vocabulary", () => {
    expect(localizeMessage("The latest S12 transition decision must be 'reduce_or_divest'.")).toContain(tr(TRANSITION_DECISION_KEY.reduce_or_divest));
  });

  test("localizeMessage translates raw system errors to Korean (D-21)", () => {
    expect(localizeMessage("Failed to fetch")).not.toMatch(/Failed/);
    expect(localizeMessage("Request failed.")).not.toMatch(/Request failed/);
  });

  test("localizeRequirement renders S12 spec sentences without raw identifiers (W3-09 family)", () => {
    const out = localizeRequirement(
      "사람 전환 결정 기록(어휘 5종: next_tranche_released / held_evidence_incomplete / graduate_to_core / reduce_or_divest / kill_with_learning_captured, decided_by=venture-portfolio-ic, rationale 필수 — venture_transition_decision 원장)",
    );
    expect(out).not.toContain("next_tranche_released");
    expect(out).not.toContain("decided_by=");
    expect(out).not.toContain("venture_transition_decision");
    expect(out).toContain("어휘 5종");
  });
});

describe("resolveLabel", () => {
  test("known key", () => {
    expect(resolveLabel({ fs: "타당성 분석(FS)" }, "fs")).toEqual({ label: "타당성 분석(FS)", raw: "fs", isFallback: false });
  });
  test("unknown key -> placeholder, raw preserved, raw never in label", () => {
    const r = resolveLabel({ fs: "타당성 분석(FS)" }, "zzz_new_gate");
    expect(r).toEqual({ label: UNCLASSIFIED_LABEL, raw: "zzz_new_gate", isFallback: true });
    expect(r.label).not.toContain("zzz");
  });
  test("empty / null never blank; prototype keys are not hits", () => {
    expect(resolveLabel({ fs: "타당성 분석(FS)" }, null).label).toBe("—");
    expect(resolveLabel({ fs: "타당성 분석(FS)" }, "").isFallback).toBe(true);
    expect(resolveLabel({ fs: "타당성 분석(FS)" }, "toString").isFallback).toBe(true);
    expect(labelText({ fs: "타당성 분석(FS)" }, undefined)).toBe("—");
  });
});

describe("track key parts", () => {
  test("combinations resolve through the ko catalog", () => {
    expect(tr(trackKeysText(null))).toBe("미결정");
    expect(resolveLabelTokens(trackKeysText("greenfield"), tr)).toBe(tr(TRACK_KEY.greenfield));
    expect(resolveLabelTokens(trackKeysText("brownfield", "m_and_a"), tr)).toBe(`${tr(TRACK_KEY.brownfield)} · ${tr(SUB_TRACK_KEY.m_and_a)}`);
    expect(resolveLabelTokens(trackKeysText("greenfield", "existing_business_rbd"), tr)).toContain(tr(SUB_TRACK_KEY.existing_business_rbd));
  });
  test("parts keep raw keys for the disclosure", () => {
    expect(trackKeyParts("brownfield", "weird").map((p) => p.raw)).toEqual(["brownfield", "weird"]);
    expect(trackKeyParts("brownfield", "weird").map((p) => p.key === null)).toEqual([false, true]);
  });
});

describe("dedupTermNames", () => {
  test("equal ko/en (case-insensitive) shows one name", () => {
    expect(dedupTermNames("Green Field", "green field ")).toEqual({ primary: "Green Field", secondary: null });
    expect(dedupTermNames("그린필드", "Green Field")).toEqual({ primary: "그린필드", secondary: "Green Field" });
    expect(dedupTermNames("", "Run")).toEqual({ primary: "Run", secondary: null });
    expect(dedupTermNames("실행", "")).toEqual({ primary: "실행", secondary: null });
  });
});

describe("glossary-backed wording (source-reading)", () => {
  const load = (f: string) => (yaml.load(readFileSync(`glossary/${f}.yaml`, "utf8")) as { terms: Record<string, { ko: string; category: string }> }).terms;
  const business = load("business");
  const industry = load("industry");

  test("gate and track ko catalog values contain the glossary ko (i18n re-pin T3-6)", () => {
    expect(tr(GATE_LABEL_KEY.pre_fs)).toContain(business["Pre-FS"]!.ko);
    expect(tr(GATE_LABEL_KEY.entity_ic)).toContain(business["Entity IC"]!.ko);
    expect(tr(GATE_LABEL_KEY.group_ic)).toContain(business["Group IC"]!.ko);
    expect(tr(TRACK_KEY.greenfield)).toContain(business["Green Field"]!.ko);
    expect(tr(TRACK_KEY.brownfield)).toContain(business["Brown Field"]!.ko);
  });
  test("DART corp code label equals glossary corp_code.ko (common.dartId, i18n re-pin T3-6)", () => {
    expect(ko.common.dartId).toBe(industry.corp_code!.ko);
  });
});
