// S7 target evaluation — 2026-10-20 decider round: explicit per-category save (edits stay local
// until 저장, button bottom-right after the add-row), the score chip shows judged/total items,
// the S7 gate kill hint follows flow.spec (knock-out 통과 후보 0건) and evaluation completeness is
// an informational note; the S7 capability-readiness notice/route are retired.
import { test, expect, describe } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { computeEvalScore } from "../../app/web-next/lib/brownfield-eval-criteria.ts";

const ROOT = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("score formula (decider ask: are the scores computed correctly?)", () => {
  const it = (category: "financial" | "technical", status: string | null, weight = 10) =>
    ({ category, weight, state: status ? { status: status as never } : null });
  test("weighted mean of pass=1 / partial=0.5 / fail=0 over judged items; pending and na/waived excluded; rounded", () => {
    const s = computeEvalScore([
      it("financial", "pass"), it("financial", "partial"), it("financial", "pass"), it("financial", "partial"),
      it("technical", "pass"), it("technical", "pass"), it("technical", "partial"), it("technical", "partial"),
      it("technical", "na"), it("technical", "fail"), it("technical", "partial"), it("technical", null),
    ]);
    expect(s.financial.score).toBe(75); // (1+0.5+1+0.5)/4
    expect(s.technical.score).toBe(58); // (1+1+0.5+0.5+0+0.5)/6 = 0.5833 — na and pending excluded
    expect(s.technical.scoredWeight).toBe(60);
    expect(s.technical.totalWeight).toBe(70); // pending counts toward the remaining weight, na does not
    expect(s.technical.excludedWeight).toBe(10);
    expect(computeEvalScore([it("technical", null)]).technical.score).toBeNull();
  });
  test("weights matter: a heavier item moves the mean", () => {
    const s = computeEvalScore([it("technical", "pass", 30), it("technical", "fail", 10)]);
    expect(s.technical.score).toBe(75);
  });
});

// ko is the master catalog (design D2) — literal contracts pin the ko value.
const koCatalog = await import("../../app/web-next/locales/ko.json");
const koOf = (key: string): string =>
  key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), koCatalog) as string;

describe("S7 surfaces", () => {
  test("eval tab: edits are local until the category 저장 button; the bar sits after the add-row, right-aligned; score shows judged/total", () => {
    const src = read("app/web-next/components/brownfield-target/TargetEvalTab.tsx");
    expect(src).toContain("const [pending, setPending] = useState<Record<string, PendingEdit>>({});");
    expect(src).toContain("async function saveCategory(");
    expect(src).toContain("editPending(it.id, { status: v, note: draft ? draft.note : undefined });");
    expect(src).not.toContain("void setEvalVerdict(it.id, v,"); // no save-on-change
    expect(src).not.toMatch(/onBlur=\{\(e\) => \{\s*const v = Number\(e\.target\.value\);\s*if \(v > 0 && v !== it\.weight\) void setEvalWeight/);
    // i18n (design 2026-10-23-i18n-ui-adoption): the judged/total literal moved to
    // evalTab.judgedCountLabel — pin the key call site + the ko master value (module-level koCatalog below).
    expect(src).toContain('t("judgedCountLabel", { p1: judgedCount, p2: countedTotal })');
    expect(koOf("components.brownfieldTarget.evalTab.judgedCountLabel")).toBe("(판정 {p1}/{p2} 항목)");
    const addRow = src.indexOf('t("addItemAria"');
    const bar = src.indexOf('data-testid={`eval-save-bar-${cat}`}');
    expect(addRow).toBeGreaterThan(0);
    expect(bar).toBeGreaterThan(addRow);
    expect(src).toContain("justify-end");
  });
  test("S7 gate: kill hint = no knock-out survivor (flow.spec), evaluation completeness is a note; readiness notice/route retired", () => {
    const src = read("app/web-next/components/stages/brownfield/ShortlistSection.tsx");
    expect(src).toContain('!selected.targets.some((t) => t.status !== "excluded")');
    expect(src).toContain('t("zeroCandidatesPassedTheScreening")'); // i18n: stages.s67.shortlistSection.*
    expect(src).not.toContain("재무·기술 평가가 완료된 후보가 0건입니다");
    expect(src).toContain('data-testid="eval-incomplete-note"');
    expect(src).not.toContain("CapabilityReadinessNotice");
    expect(existsSync(join(ROOT, "app/web-next/app/api/brownfield/[oppId]/capability-readiness/route.ts"))).toBe(false);
    expect(read("docs/architecture/openapi.yaml")).not.toContain("/capability-readiness");
  });
});
