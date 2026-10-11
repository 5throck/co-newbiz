import { test, expect, describe } from "bun:test";
import { buildDealOverview } from "../../app/web-next/lib/deal-overview.ts";
import { documentTitle, factView, holdAgeText, holdDatesFromHistory, nextActionCopy, railStatusFromStages } from "../../app/web-next/lib/deal-overview-view.ts";
import { STAGE_META } from "../../app/web-next/lib/stage-meta.ts";

const stageName = (id: string) => STAGE_META.find((s) => s.id === id)?.name ?? null;
const proc = (over: Record<string, unknown> = {}) => ({ currentStage: "S3", blockers: ["synergy_analysis"], requiredArtifacts: ["synergy_analysis"], track: null, gateStatus: {}, ...over });

describe("railStatusFromStages", () => {
  test("maps process statuses to four rail states", () => {
    const m = railStatusFromStages([
      { id: "S1", status: "complete" }, { id: "S2", status: "current" }, { id: "S3", status: "skipped" },
      { id: "S4", status: "locked" }, { id: "S5", status: "blocked" }, { id: "S6", status: "terminated" },
    ]);
    expect(m).toEqual({ S1: "complete", S2: "current", S3: "skipped", S4: "pending", S5: "pending", S6: "pending" });
  });
});

describe("nextActionCopy", () => {
  test("covers all four action types with a specific what/why/cta and no raw enums", () => {
    const base = { name: "딜", status: "assessed", attractiveness_score: 72, synergy_score: null };
    const rec = nextActionCopy(buildDealOverview("o1", base, proc() as never).nextAction!);
    expect(rec.what).toContain("기록");
    expect(rec.cta).toContain("S3");
    const hold = nextActionCopy(buildDealOverview("o1", base, proc({ gateStatus: { screening: "hold" } }) as never, [{ entityType: "opportunity", entityId: "o1", gate: "screening" }]).nextAction!);
    expect(hold.what).toContain("보류 해소");
    expect(hold.why).toContain("멈춥니다");
    for (const c of [rec, hold]) expect(`${c.what}${c.why}${c.cta}`).not.toMatch(/record_artifact|resolve_hold|undefined|NaN/);
  });
  test("does not double the record verb when the artifact label already ends with it", () => {
    const a = { type: "record_artifact", subject: "대상 선정 기록", reason: { type: "artifact_missing", stageId: "S8", stageName: "사업성 분석", done: 0, total: 1 }, href: "/x", buttonTarget: "S8 사업성 분석" } as const;
    expect(nextActionCopy(a).what).toBe("대상 선정 기록");
  });
  test("gate and advance branches", () => {
    const base = { name: "딜", status: "assessed", attractiveness_score: 72, synergy_score: 60 };
    const gate = buildDealOverview("o1", base, proc({ blockers: [], requiredArtifacts: [] }) as never).nextAction!;
    expect(gate.type).toBe("request_gate_decision");
    expect(nextActionCopy(gate).cta).toContain("결정");
    const adv = buildDealOverview("o1", base, proc({ blockers: [], requiredArtifacts: [], gateStatus: { screening: "go" } }) as never).nextAction!;
    expect(adv.type).toBe("advance_stage");
    expect(nextActionCopy(adv).what).toContain("단계로 진행");
  });
});

describe("factView", () => {
  test("pending names the stage, never the generic not-recorded text (S3 deal)", () => {
    const ov = buildDealOverview("o1", { name: "딜", status: "assessed", attractiveness_score: 72, synergy_score: null }, proc() as never);
    const track = factView(ov.facts.find((f) => f.key === "track")!, stageName);
    expect(track.state).toBe("pending");
    expect(track.text).toContain("S4");
    expect(track.text).not.toContain("미기록");
    expect(track.linkText).toBeNull();
    const gate = factView(ov.facts.find((f) => f.key === "gate")!, stageName);
    expect(gate.state).toBe("none");
    expect(gate.linkText).not.toBeNull();
    expect(gate.href).toContain("/deals/o1");
  });
  test("missing links to where to record it", () => {
    const ov = buildDealOverview("o1", { name: "딜", status: "selected", attractiveness_score: null, synergy_score: 50 }, proc({ currentStage: "S4" }) as never);
    const a = factView(ov.facts.find((f) => f.key === "attractiveness")!, stageName);
    expect(a.state).toBe("missing");
    expect(a.href).toBeTruthy();
    expect(a.linkText).not.toBeNull();
  });
});

describe("holds and title", () => {
  test("holdAgeText", () => {
    expect(holdAgeText(null)).toBeNull();
    expect(holdAgeText(0)).toBe("오늘 보류됨");
    expect(holdAgeText(3)).toBe("3일째 보류");
  });
  test("holdDatesFromHistory keeps the latest hold per gate and ignores other decisions", () => {
    expect(holdDatesFromHistory([
      { gate: "screening", decision: "go", decided_at: "2026-10-10" },
      { gate: "screening", decision: "hold", decided_at: "2026-10-09" },
      { gate: "screening", decision: "hold", decided_at: "2026-10-01" },
    ])).toEqual({ screening: "2026-10-09" });
    expect(holdDatesFromHistory(null)).toEqual({});
  });
  test("documentTitle", () => {
    expect(documentTitle("A딜", "개요")).toBe("A딜 - 개요");
    expect(documentTitle(null, "개요")).toBe("개요");
  });
});
