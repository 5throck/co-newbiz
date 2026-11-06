import { describe, expect, test } from "bun:test";
import { hasStructuralGaps, runAiFirstChecks } from "../../app/web-next/lib/review/ai-first.ts";
import { ai2ndPayloadContent, buildAi2ndMessages } from "../../app/web-next/lib/review/ai-second.ts";
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
        {
          id: "S4",
          name: "진출방식",
          status: "current",
          required_artifacts: [],
          blockers: [],
          missing_artifacts: ["트랙 결정", "대안"],
        },
      ]),
    );
    expect(b.could_not_verify.find((i) => i.claim.includes("is incomplete"))!.reason).toContain(
      "Missing: 트랙 결정; 대안.",
    );
  });

  test("helpers", () => {
    expect(cleanList([" a ", "", null, undefined])).toEqual(["a"]);
    expect(joinBlockers(["x", "", "y"])).toBe("x / y");
  });
});

describe("fix 1 - not-reached stages are informational", () => {
  const st = (
    id: string,
    status: GateArtifact["stages"][number]["status"],
    extra: Partial<GateArtifact["stages"][number]> = {},
  ) => ({
    id: id as GateArtifact["stages"][number]["id"],
    name: `n${id}`,
    status,
    required_artifacts: [],
    blockers: [],
    missing_artifacts: [],
    ...extra,
  });

  test("S3-current entity: S4 is a non-structural not_reached item, no structural gap beyond the current stage", () => {
    const b = runAiFirstChecks(
      artifact([
        st("S1", "complete"),
        st("S2", "complete"),
        st("S3", "complete"),
        st("S4", "locked", { not_reached: true }),
      ]),
    );
    const nr = b.could_not_verify.filter((i) => i.scope === "not_reached");
    expect(nr).toHaveLength(1);
    expect(nr[0]!.structural).toBe(false);
    expect(nr[0]!.claim).toContain("S4");
    expect(hasStructuralGaps(b)).toBe(false);
    const l = localizeItem(nr[0]!);
    expect(l.localized).toBe(true);
    expect(l.claim).toContain("도달하지 않았습니다");
    expect(b.could_not_verify.length).toBeGreaterThan(1); // standing accuracy note is still declared
  });

  test("predecessor-locked (no not_reached flag), current-incomplete and terminated stay structural", () => {
    for (const status of ["locked", "current", "terminated"] as const) {
      const b = runAiFirstChecks(artifact([st("S1", status)]));
      expect(hasStructuralGaps(b)).toBe(true);
      expect(b.could_not_verify.some((i) => i.scope === "not_reached")).toBe(false);
    }
  });

  test("AI 2nd payload excludes not_reached stages", () => {
    const content = { gate: "screening", stages: [st("S3", "complete"), st("S4", "locked", { not_reached: true })] };
    expect((ai2ndPayloadContent(content).stages as unknown[]).length).toBe(1);
    const a = { ...artifact([]), content };
    const msgs = buildAi2ndMessages(a, "platform-lead", "technical", "functional");
    const user = msgs[1]!.content;
    expect(user).toContain('"id":"S3"');
    expect(user).not.toContain('"id":"S4"');
    expect(msgs[0]!.content).toContain("not reached yet");
  });
});

describe("item 5 - ko catalog", () => {
  test("every AI 1st template localizes (no English fallthrough, no file paths)", () => {
    const b = runAiFirstChecks(
      artifact([
        {
          id: "S1",
          name: "시장",
          status: "complete",
          required_artifacts: ["시장 규모"],
          blockers: [],
          missing_artifacts: [],
        },
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
    expect(bucketCounts([s("AI 1st", true), s("AI 2nd", false)])).toEqual({
      verified: 2,
      could_not_verify: 1,
      needs_judgement: 3,
    });
  });
});

import { readFileSync } from "node:fs";
import {
  localizeItem as _li,
  localizeNotPerformedReason,
  reviewDomainLabel,
  reviewOriginText,
  tidyReasonText,
} from "../../app/web-next/lib/review/review-display.ts";

describe("inbox text hygiene (QA sweep B1/B2)", () => {
  test("cleanList drops punctuation-only entries", () => {
    expect(cleanList([".", " - ", "a", "3"])).toEqual(["a", "3"]);
  });
  test("B1 reproduction: empty payloads render no ': .' or '..'", () => {
    const stored = "screening 진행 HOLD — 보완 필요: . Missing: ..";
    const out = _li({ claim: "Stage S6 (Screening) is incomplete", reason: stored }).reason;
    expect(out).not.toMatch(/: \.|\.\./);
    expect(out).toContain("근거 확인");
    expect(out).not.toContain("누락된 산출물");
  });
  test("non-empty lists unchanged; unknown text passes through", () => {
    const r = _li({
      claim: "Stage S6 (X) is incomplete",
      reason: "screening 진행 HOLD — 보완 필요: a. Missing: b; c.",
    }).reason;
    expect(r).toContain("누락된 산출물: b; c.");
    expect(_li({ claim: "zzz", reason: "free text.." }).reason).toBe("free text.");
    expect(tidyReasonText("Some... ellipsis")).toBe("Some... ellipsis");
    expect(_li({ claim: "zzz", reason: "plain" })).toEqual({ claim: "zzz", reason: "plain", localized: false });
  });
  test("reviewOriginText", () => {
    expect(reviewOriginText({ origin: "AI 1st", performed: true })).toBe("AI 1차 (결정론 검사)");
    expect(
      reviewOriginText({
        origin: "AI 2nd",
        performed: true,
        reviewer_domain: "technical",
        reviewer_agent: "platform-lead",
      }),
    ).toBe("AI 2차 · 기술 도메인 · platform-lead");
    for (const s of [
      { origin: "AI 2nd", performed: false, reviewer_domain: null, reviewer_agent: "none" },
      { origin: "AI 2nd", performed: true, reviewer_domain: null, reviewer_agent: "none" },
    ]) {
      const t = reviewOriginText(s);
      expect(t).toBe("AI 2차 · 수행되지 않음");
      expect(t).not.toMatch(/\?|none/);
    }
    expect(reviewDomainLabel("none")).toBeNull();
    expect(citationLabel("AI 2nd", null)).toBe("AI 2차");
  });
  test("B2 reproduction: structural-gaps reason is Korean", () => {
    const en = "AI 1st found structural gaps (incomplete or locked stages); nothing worth cross-domain review yet";
    expect(localizeNotPerformedReason(en)).not.toMatch(/[A-Za-z]{4}/);
  });
  test("fallback reason: a same-domain matrix reviewer is described as the SAME domain (not different)", () => {
    const ko = localizeNotPerformedReason(
      "matrix reviewer 'risk-officer' is not cross-domain for authors in functional (counts as first stage only); default cross-domain lead platform-lead reviewed. Specialist risk-officer is same-domain (first stage only).",
    );
    expect(ko).toContain("과 같아 교차 검토가 되지 않아");
    expect(ko).not.toContain("과 달라");
    expect(ko).toContain("platform-lead");
  });
  test("guard: every not-performed reason in ai-second.ts / domains.ts has a Korean catalog entry", () => {
    const root = "app/web-next/lib/review/";
    const src = readFileSync(root + "ai-second.ts", "utf8") + readFileSync(root + "domains.ts", "utf8");
    const lits = [...src.matchAll(/\breason(?::|\s*\?\?)\s*"([^"]+)"|\breason:\s*`([^`]+)`/g)].map((m) =>
      (m[1] ?? m[2]!).replace(/\$\{[^}]*\}/g, (e) => (/used|cap/.test(e) ? "5" : "x")),
    );
    expect(lits.length).toBeGreaterThanOrEqual(7);
    for (const l of lits) {
      const k = localizeNotPerformedReason(l);
      expect({ l, changed: k !== l }).toEqual({ l, changed: true });
      expect(k).not.toMatch(/[A-Za-z]{4}/);
    }
    const claims = [...src.matchAll(/claim: "([^"]+)"/g)].map((m) => m[1]!);
    for (const c of claims) expect(localizeNotPerformedReason(c)).not.toBe(c);
  });
});
