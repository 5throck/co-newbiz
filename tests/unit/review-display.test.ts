import { describe, expect, test } from "bun:test";
import { runAiFirstChecks } from "../../app/web-next/lib/review/ai-first.ts";
import type { GateArtifact } from "../../app/web-next/lib/review/gate-artifacts.ts";
import {
  BUCKET_TITLE,
  bucketCounts,
  citationLabel,
  cleanList,
  holdBlockerText,
  joinBlockers,
  localizeItem,
} from "../../app/web-next/lib/review/review-display.ts";

// Critique 2026-10-09 items 1 and 5: the empty "보완 필요: . Missing: .." join and the ko catalog.

function artifact(stages: GateArtifact["stages"]): GateArtifact {
  return {
    gate: "screening",
    artifactKey: "gate:screening",
    entityType: "opportunity",
    entityId: "x",
    stageId: "S4",
    stages,
    authorAgents: [],
    content: {},
    contentHash: "h",
  };
}

describe("item 1 - empty missing join", () => {
  test("HOLD blocker never renders an empty list", () => {
    expect(holdBlockerText("screening", [])).toBe("screening 진행 HOLD — 보완 필요: 근거 확인");
    expect(holdBlockerText("screening", [""])).toBe("screening 진행 HOLD — 보완 필요: 근거 확인");
    expect(holdBlockerText("fs", ["  ", "재무 모델"])).toBe("fs 진행 HOLD — 보완 필요: 재무 모델");
    expect(holdBlockerText("fs", undefined)).toContain("근거 확인");
  });

  test("blank artifact names and a dangling label produce no 'Missing: .' text", () => {
    const b = runAiFirstChecks(
      artifact([
        {
          id: "S4",
          name: "진출방식",
          status: "current",
          required_artifacts: [],
          blockers: ["screening 진행 HOLD — 보완 필요: ", ""],
          missing_artifacts: ["", " "],
        },
      ]),
    );
    const item = b.could_not_verify.find((i) => i.claim.includes("is incomplete"))!;
    expect(item.reason).not.toContain("Missing");
    expect(item.reason).not.toMatch(/: \./);
    expect(item.reason).toContain("보완 필요: 근거 확인");
  });

  test("real missing artifacts are still reported", () => {
    const b = runAiFirstChecks(
      artifact([
        { id: "S4", name: "진출방식", status: "current", required_artifacts: [], blockers: [], missing_artifacts: ["트랙 결정", "대안"] },
      ]),
    );
    expect(b.could_not_verify.find((i) => i.claim.includes("is incomplete"))!.reason).toContain("Missing: 트랙 결정; 대안.");
  });

  test("helpers", () => {
    expect(cleanList([" a ", "", null, undefined])).toEqual(["a"]);
    expect(joinBlockers(["x", "", "y"])).toBe("x / y");
  });
});

describe("item 5 - ko catalog", () => {
  test("every AI 1st template localizes (no English fallthrough, no file paths)", () => {
    const b = runAiFirstChecks(
      artifact([
        { id: "S1", name: "시장", status: "complete", required_artifacts: ["시장 규모"], blockers: [], missing_artifacts: [] },
        { id: "S2", name: "기회", status: "skipped", required_artifacts: [], blockers: [], missing_artifacts: [] },
        { id: "S3", name: "시너지", status: "terminated", required_artifacts: [], blockers: [], missing_artifacts: [] },
        {
          id: "S4",
          name: "진출방식",
          status: "current",
          required_artifacts: [],
          blockers: ["screening 진행 HOLD — 보완 필요: 대안"],
          missing_artifacts: ["대안"],
        },
        { id: "S5", name: "역량", status: "locked", required_artifacts: [], blockers: [], missing_artifacts: [] },
      ]),
    );
    const all = [...b.verified, ...b.could_not_verify, ...b.needs_judgement];
    expect(all.length).toBeGreaterThan(6);
    for (const it of all) {
      const l = localizeItem(it);
      expect(l.localized).toBe(true);
      expect(`${l.claim} ${l.reason}`).not.toMatch(/lib\/|flow\.spec|Missing:|[A-Za-z]{4,} (is|was|are) /);
    }
    const inc = localizeItem(b.could_not_verify.find((i) => i.claim.includes("is incomplete"))!);
    expect(inc.reason).toContain("Screening 진행 HOLD");
    expect(inc.reason).toContain("누락된 산출물: 대안");
  });

  test("unknown (AI 2nd) text passes through and could-not-verify wording is exact", () => {
    expect(localizeItem({ claim: "Customer list", reason: "시장 데이터가 없음" })).toEqual({
      claim: "Customer list",
      reason: "시장 데이터가 없음",
      localized: false,
    });
    expect(BUCKET_TITLE.verified.ko).toBe("확인됨");
    expect(BUCKET_TITLE.could_not_verify.ko).toBe("확인하지 못함");
    expect(BUCKET_TITLE.needs_judgement.ko).toBe("판단 필요");
  });

  test("citations hide stage identifiers; counts skip unperformed AI 2nd", () => {
    expect(citationLabel("AI 1st", null, "stage:S8")).toBe("AI 1차 · S8 단계");
    const s = (origin: string, performed: boolean) => ({
      origin,
      performed,
      verified: [1, 2],
      could_not_verify: [1],
      needs_judgement: [1, 2, 3],
    });
    expect(bucketCounts([s("AI 1st", true), s("AI 2nd", false)])).toEqual({ verified: 2, could_not_verify: 1, needs_judgement: 3 });
  });
});
