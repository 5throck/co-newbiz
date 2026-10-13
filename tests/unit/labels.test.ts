import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";
import {
  localizeRequirement,
  BF_SUB, DART_CORP_CODE_LABEL, DECISION_MODE_LABEL, GATE_LABEL, GF_SUB, GLOSSARY_CATEGORY_LABEL, INTENT_LABEL, ORIGIN_LABEL,
  RAG_DIMENSION_LABEL, RAG_DIMENSION_ORDER, RECORD_KEY_LABEL, STAGE_STATUS_LABEL, SUB_TRACK_LABEL, TRACK_LABEL,
  TRANSITION_DECISION_LABEL, FINDING_CATEGORY_LABEL, UNCLASSIFIED_LABEL, dedupTermNames, gateLabel, glossaryCategoryLabel,
  labelText, localizeMessage, ragDimensionsLabel, resolveLabel, trackLabel, trackLabelParts,
} from "../../app/web-next/lib/labels.ts";
import { GF_SUB as ReGF, BF_SUB as ReBF } from "../../app/web-next/components/stages/route-decision/constants.ts";

const MAPS: Record<string, Record<string, string>> = {
  GATE_LABEL, TRACK_LABEL, GF_SUB, BF_SUB, SUB_TRACK_LABEL, ORIGIN_LABEL, INTENT_LABEL, STAGE_STATUS_LABEL, DECISION_MODE_LABEL,
  TRANSITION_DECISION_LABEL, RAG_DIMENSION_LABEL, RECORD_KEY_LABEL, GLOSSARY_CATEGORY_LABEL, FINDING_CATEGORY_LABEL,
};

describe("label maps", () => {
  for (const [name, map] of Object.entries(MAPS)) {
    test(`${name}: every key maps to non-empty Korean that is not the raw key`, () => {
      expect(Object.keys(map).length).toBeGreaterThan(0);
      for (const [k, v] of Object.entries(map)) {
        expect(v.trim().length).toBeGreaterThan(0);
        expect(v).not.toBe(k);
        // Hangul required, except established Latin deal terms (M&A); never a pure snake_case echo.
        if (!["M&A"].includes(v)) expect(/[가-힣]/.test(v)).toBe(true);
        expect(/^[a-z]+(_[a-z]+)+$/.test(v)).toBe(false);
      }
    });
  }

  test("required keys from the design are all present", () => {
    for (const k of ["screening", "pre_fs", "target_screening", "entity_ic", "group_ic", "fs", "dd"]) expect(GATE_LABEL[k]).toBeTruthy();
    for (const k of ["hybrid", "agent_team", "human_only"]) expect(DECISION_MODE_LABEL[k]).toBeTruthy();
    for (const k of ["graduate_to_core", "reduce_or_divest", "kill_with_learning_captured", "next_tranche_released", "held_evidence_incomplete"])
      expect(TRANSITION_DECISION_LABEL[k]).toBeTruthy();
    for (const k of ["existing_business_rbd", "partnership", "m_and_a"]) expect(SUB_TRACK_LABEL[k]).toBeTruthy();
    expect(STAGE_STATUS_LABEL.in_progress).toBeTruthy();
    expect(Object.keys(RAG_DIMENSION_LABEL).sort()).toEqual([...RAG_DIMENSION_ORDER].sort());
  });

  test("route-decision constants re-export the single map", () => {
    expect(ReGF).toBe(GF_SUB);
    expect(ReBF).toBe(BF_SUB);
  });

  test("localizeMessage uses the transition map", () => {
    expect(localizeMessage("The latest S12 transition decision must be 'reduce_or_divest'.")).toContain(TRANSITION_DECISION_LABEL.reduce_or_divest!);
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
    expect(resolveLabel(GATE_LABEL, "fs")).toEqual({ label: GATE_LABEL.fs!, raw: "fs", isFallback: false });
  });
  test("unknown key -> placeholder, raw preserved, raw never in label", () => {
    const r = resolveLabel(GATE_LABEL, "zzz_new_gate");
    expect(r).toEqual({ label: UNCLASSIFIED_LABEL, raw: "zzz_new_gate", isFallback: true });
    expect(r.label).not.toContain("zzz");
  });
  test("empty / null never blank; prototype keys are not hits", () => {
    expect(resolveLabel(GATE_LABEL, null).label).toBe("—");
    expect(resolveLabel(GATE_LABEL, "").isFallback).toBe(true);
    expect(resolveLabel(GATE_LABEL, "toString").isFallback).toBe(true);
    expect(labelText(GATE_LABEL, undefined)).toBe("—");
    expect(gateLabel("dd")).toBe(GATE_LABEL.dd!);
  });
});

describe("trackLabel", () => {
  test("combinations", () => {
    expect(trackLabel(null)).toBe("미결정");
    expect(trackLabel("greenfield")).toBe(TRACK_LABEL.greenfield!);
    expect(trackLabel("brownfield", "m_and_a")).toBe(`${TRACK_LABEL.brownfield} · ${BF_SUB.m_and_a}`);
    expect(trackLabel("greenfield", "existing_business_rbd")).toContain(GF_SUB.existing_business_rbd!);
    expect(trackLabel("brownfield", "weird")).toContain(UNCLASSIFIED_LABEL);
    expect(trackLabel("brownfield", "weird")).not.toContain("weird");
  });
  test("parts keep raw keys for the disclosure", () => {
    expect(trackLabelParts("brownfield", "weird").map((p) => p.raw)).toEqual(["brownfield", "weird"]);
  });
});

describe("ragDimensionsLabel", () => {
  test("canonical order, dedup, unknown as placeholder", () => {
    expect(ragDimensionsLabel(["risk", "financial", "risk"])).toBe(`${RAG_DIMENSION_LABEL.financial}, ${RAG_DIMENSION_LABEL.risk}`);
    expect(ragDimensionsLabel(["bogus", "market"])).toBe(`${RAG_DIMENSION_LABEL.market}, ${UNCLASSIFIED_LABEL}`);
    expect(ragDimensionsLabel([])).toBe("");
    expect(ragDimensionsLabel(null)).toBe("");
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

  test("gate and track labels contain the glossary ko", () => {
    expect(GATE_LABEL.pre_fs).toContain(business["Pre-FS"]!.ko);
    expect(GATE_LABEL.entity_ic).toContain(business["Entity IC"]!.ko);
    expect(GATE_LABEL.group_ic).toContain(business["Group IC"]!.ko);
    expect(TRACK_LABEL.greenfield).toContain(business["Green Field"]!.ko);
    expect(TRACK_LABEL.brownfield).toContain(business["Brown Field"]!.ko);
  });
  test("DART corp code label equals glossary corp_code.ko", () => {
    expect(DART_CORP_CODE_LABEL).toBe(industry.corp_code!.ko);
  });
  test("every glossary category (schema enum, term files, /glossary page source) is mapped", () => {
    const schema = readFileSync("glossary/_schema.yaml", "utf8");
    const enumLine = /category:\s*\n\s*type: string\s*\n\s*enum: \[([^\]]+)\]/.exec(schema)![1]!;
    const enumCats = enumLine.split(",").map((s) => s.trim());
    const used = new Set<string>();
    for (const f of ["business", "financial", "industry", "legal", "technical"]) for (const t of Object.values(load(f))) used.add(t.category);
    for (const c of [...enumCats, ...used]) {
      expect(GLOSSARY_CATEGORY_LABEL[c]).toBeTruthy();
      expect(glossaryCategoryLabel(c.toUpperCase()).isFallback).toBe(false); // /glossary shows BUSINESS (uppercased)
    }
    const page = readFileSync("app/web-next/app/glossary/page.tsx", "utf8");
    expect(page).toContain("category"); // page renders t.category; Row 2 switches it to glossaryCategoryLabel
  });
});

describe("INTERIM-WORDING markers", () => {
  test("every interim entry is marked and lists a question id", () => {
    const src = readFileSync("app/web-next/lib/labels.ts", "utf8");
    // Entry markers always carry a question id (Q1..Q7 or Qx for the design's uncatalogued extras);
    // the header prose mentions the marker without an id and is excluded.
    const marked = src.split("\n").filter((l) => /INTERIM-WORDING Q(\d|x)\b/.test(l));
    expect(marked.length).toBeGreaterThan(10);
    for (const l of marked) expect(/INTERIM-WORDING Q(\d|x)/.test(l)).toBe(true);
  });
});
