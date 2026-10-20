// S9 기술 항목 판정 (T2~T5) — 2026-10-20 decider round 4: the S8 technical lens items
// are recorded in S9 (sidecar opportunity.technical_item_verdicts_json, migration 0157)
// and S8 derives them read-only; T6 reports the S8↔S9 pairing progress. Pure lib rules,
// the lens derivation, and source guards on the two surfaces + the route.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TECHNICAL_ITEM_KEYS,
  TECHNICAL_ITEM_VERDICTS,
  mergeTechnicalItemVerdicts,
  parseTechnicalItemVerdicts,
  serializeTechnicalItemVerdicts,
  validateTechnicalItemVerdictInput,
  TechnicalItemValidationError,
  type TechnicalItemVerdict,
} from "../../app/web-next/lib/technical-item-verdicts.ts";
import { summarizeTechnicalLens } from "../../app/web-next/lib/technical-lens.ts";

const ROOT = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const v = (over: Partial<TechnicalItemVerdict> = {}): TechnicalItemVerdict => ({
  itemKey: "T2", verdict: "met", note: "TRL 7 실측 — 조사내역 #3", by: "u", at: "2026-10-20T00:00:00.000Z", ...over,
});

describe("technical-item verdicts — lib rules", () => {
  test("only T2-T5 and met/caution/unmet are accepted; the note is trimmed and capped", () => {
    expect([...TECHNICAL_ITEM_KEYS]).toEqual(["T2", "T3", "T4", "T5"]);
    expect([...TECHNICAL_ITEM_VERDICTS]).toEqual(["met", "caution", "unmet"]);
    const ok = validateTechnicalItemVerdictInput({ itemKey: "T3", verdict: "caution", note: "  설비 잔존 5년  " });
    expect(ok).toMatchObject({ itemKey: "T3", verdict: "caution", note: "설비 잔존 5년", by: "", at: "" });
    expect(() => validateTechnicalItemVerdictInput({ itemKey: "T1", verdict: "met" })).toThrow(TechnicalItemValidationError);
    expect(() => validateTechnicalItemVerdictInput({ itemKey: "T6", verdict: "met" })).toThrow(TechnicalItemValidationError);
    expect(() => validateTechnicalItemVerdictInput({ itemKey: "T2", verdict: "resolved" })).toThrow(TechnicalItemValidationError);
    expect(() => validateTechnicalItemVerdictInput({ itemKey: "T2", verdict: "met", note: "x".repeat(2001) })).toThrow(TechnicalItemValidationError);
  });

  test("parse is tolerant (bad rows dropped, bad JSON empty) and round-trips serialize", () => {
    expect(parseTechnicalItemVerdicts(null)).toEqual([]);
    expect(parseTechnicalItemVerdicts("{nope")).toEqual([]);
    const raw = serializeTechnicalItemVerdicts([v(), { itemKey: "T9", verdict: "met", note: "", by: "u", at: "x" } as unknown as TechnicalItemVerdict]);
    expect(parseTechnicalItemVerdicts(raw)).toEqual([v()]);
  });

  test("merge keeps one verdict per item key (latest wins) in T2→T5 order", () => {
    const merged = mergeTechnicalItemVerdicts([v({ itemKey: "T5" }), v({ itemKey: "T2", verdict: "caution" })], v({ itemKey: "T2", verdict: "unmet", note: "재판정" }));
    expect(merged.map((m) => `${m.itemKey}:${m.verdict}`)).toEqual(["T2:unmet", "T5:met"]);
  });
});

describe("S8 lens derives T2-T5 from the S9 verdicts; T6 is the pairing progress", () => {
  test("without S9 verdicts the items stay unjudged and point at S9 (no 'next release' note)", () => {
    const s = summarizeTechnicalLens([], null, {});
    const t2 = s.items.find((i) => i.key === "T2")!;
    expect(t2.judged).toBe(false);
    expect(t2.note).toContain("S9 실사·검증");
    expect(t2.note).not.toContain("다음 릴리스");
    const t6 = s.items.find((i) => i.key === "T6")!;
    expect(t6.judged).toBe(false);
    expect(t6.note).toContain("0/4");
  });

  test("an S9 verdict judges the item: met→met, caution/unmet→caution (warning-only), note carries recorder and verdict", () => {
    const s9Items = { T2: v(), T3: v({ itemKey: "T3", verdict: "unmet", note: "핵심 설비 노후" }) };
    const s = summarizeTechnicalLens([], null, { s9Items });
    const t2 = s.items.find((i) => i.key === "T2")!;
    expect(t2).toMatchObject({ judged: true, derived: true, status: "met" });
    expect(t2.note).toContain("S9 판정 (충족)");
    expect(t2.note).toContain("u · 2026-10-20");
    const t3 = s.items.find((i) => i.key === "T3")!;
    expect(t3).toMatchObject({ judged: true, status: "caution" });
    expect(t3.note).toContain("미충족");
    expect(t3.note).toContain("핵심 설비 노후");
    expect(s.items.find((i) => i.key === "T6")!.note).toContain("2/4");
    expect(s.judged).toBe(2); // T2, T3 — T1 (no rows), T4, T5, T6 unjudged
  });

  test("all four S9 verdicts complete the pairing: T6 judged + met", () => {
    const s9Items = Object.fromEntries(TECHNICAL_ITEM_KEYS.map((k) => [k, v({ itemKey: k })]));
    const t6 = summarizeTechnicalLens([], null, { s9Items }).items.find((i) => i.key === "T6")!;
    expect(t6).toMatchObject({ judged: true, status: "met" });
    expect(t6.note).toContain("모두");
  });
});

describe("source guards — surfaces and route", () => {
  test("S8 TechnicalLensPanel renders the six items as tabs: T1 → capability panel, T2-T5 → S9-derived view, T6 → pairing", () => {
    const panel = read("app/web-next/components/stages/TechnicalLensPanel.tsx");
    expect(panel).toContain('role="tablist"');
    expect(panel).toContain('data-testid="tech-item-tabs"');
    expect(panel).toContain('role="tabpanel"');
    expect(panel).toContain('active.key === "T1"');
    expect(panel).toContain("<CapabilityAttainabilityPanel projectId={projectId} />");
    expect(panel).toContain("TechItemVerdictView");
    expect(panel).toContain('active.key === "T6"');
    expect(panel).toContain("PairingView");
    // reflection only — no writes from S8
    expect(panel).not.toContain("api.put");
    expect(panel).not.toContain("api.post");
    expect(panel).not.toContain("다음 릴리스");
  });

  test("S9 DdStage mounts the T2-T5 recording block on the technical domain tab only; the block is person-gated and audited through the route", () => {
    const dd = read("app/web-next/components/stages/DdStage.tsx");
    expect(dd).toContain('domain.domain === "technical" && <TechnicalItemsDdBlock projectId={projectId} canAct={canAct} />');
    const block = read("app/web-next/components/stages/TechnicalItemsDdBlock.tsx");
    expect(block).toContain('data-testid="technical-items-dd"');
    expect(block).toContain("{canAct && (");
    expect(block).toContain("/technical-items`");
    const route = read("app/web-next/app/api/projects/[id]/technical-items/route.ts");
    expect(route).toContain('requireBusinessActor(auth.auth, "write"');
    expect(route).toContain('action: "technical_item.recorded"');
    expect(route).toContain("technical_item_verdicts_json");
    // the lib stays client-safe: no db import
    const lib = read("app/web-next/lib/technical-item-verdicts.ts");
    expect(lib).not.toContain("access-control");
    expect(lib).not.toContain("bun:sqlite");
    const mig = read("db/migrations/0157_technical_item_verdicts.sql");
    expect(mig).toContain("ALTER TABLE opportunity ADD COLUMN technical_item_verdicts_json TEXT;");
  });
});
