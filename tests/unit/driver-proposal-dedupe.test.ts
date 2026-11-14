// Driver-proposal dedupe + honest overshoot signal + exclusion-arm extension
// (design 2026-11-14-driver-proposal-dedupe-overshoot, DEC-20261114-02).
//  - D-B: driverKey normalizer, DRIVER_DEDUPE_JACCARD_THRESHOLD evidence, the
//    pre-insert hard filter (identical / observed-paraphrase drops, distinct
//    passes, honest lexical-limit boundary, drop counting).
//  - D-C: buildOvershootSignal math (sum vs 2x-cap vs needed, the live-case
//    numbers), nullability (no CAGR anchor, no run-start sweep).
//  - D-D: selectExclusionArm truth table + the rankExclusionCandidates-driven
//    single-culprit (fires) / multi-culprit (silent) scenarios.
//  - D-A + wiring: static-source pins (normSrc) on the pipeline — the prompt
//    block, the filter call, the drop counter, the overshoot field.
// Pure imports only — no DB, no LLM seam (the pipeline-level facts are pinned
// by source assertions, mirroring the market-growth-banner-render pattern).
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the static-source
// pins quote the pipeline's own template-literal TEXT (${acceptedNames},
// ${droppedDuplicateDrivers}, ...) inside plain strings on purpose — they
// assert source content, they are not templates (file-level suppression
// precedent: the grounding suite's header for noExplicitAny).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { normSrc } from "./helpers/src-normalize.ts";

const WEB = "../../app/web-next";
const ns = (await import(`${WEB}/lib/name-similarity.ts`)) as {
  normalizeName: (s: string) => string;
  isSimilar: (a: string, b: string[]) => boolean;
  driverKey: (s: string) => string;
  filterDuplicateDriverProposals: <T extends { driver: string }>(
    candidates: T[],
    accepted: string[],
  ) => { survivors: T[]; dropped: T[] };
  NAME_SIMILARITY_JACCARD_THRESHOLD: number;
  DRIVER_DEDUPE_JACCARD_THRESHOLD: number;
};
const sweep = (await import(`${WEB}/lib/calibration-sweep.ts`)) as {
  PLAUSIBILITY_CAP_MULTIPLE: number;
  buildOvershootSignal: (input: {
    ourCagrPct: number;
    externalCagrPct: number;
    acceptedImpacts: number[];
    runStartFeasibleRatio?: number | null;
  }) => {
    acceptedImpactSumPct: number;
    neededUpliftPct: number;
    plausibleCapPct: number;
    feasibleRatio: number | null;
    overshoot: boolean;
  } | null;
  selectExclusionArm: (input: {
    worsening: boolean;
    overshoot: boolean;
    baselineFeasibleRatio: number;
    topImprovementPct: number | null;
  }) => "worsening" | "overshoot" | null;
  rankExclusionCandidates: (input: {
    ourCagrPct: number;
    externalCagrPct: number;
    drivers: Array<{ driver: string; direction: "upside" | "downside"; impact_pct: number }>;
  }) => {
    baselineFeasibleRatio: number;
    sampleCount: number;
    ranked: Array<{ driver: string; feasibleRatioWithout: number; improvementPct: number }>;
  };
};

// 라이브 관찰(2026-11-14 드론 루프)의 실제 중복 쌍 — 토큰 Jaccard 실측치를 그대로
// 핀으로 쓴다(디자인 §5 임계값 근거).
const OBSERVED_ACCEPTED = [
  "운항 규제 완화",
  "기술 발전과 도입 비용 절감",
  "상용 드론 시장의 물류·배송 확대",
  "상업용 드론 활용 확대",
];

describe("D-B — driverKey + thresholds (name-similarity.ts)", () => {
  test("driverKey normalizes spacing/punctuation/lowercase like normalizeName", () => {
    expect(ns.driverKey("상용 드론 시장 확대")).toBe(ns.normalizeName("상용 드론 시장 확대"));
    expect(ns.driverKey("CAGR 상승!")).toBe("cagr상승");
    expect(ns.driverKey("  물류·배송  ")).toBe("물류배송");
  });

  test("both thresholds are named constants with the documented values", () => {
    expect(ns.NAME_SIMILARITY_JACCARD_THRESHOLD).toBe(0.6);
    expect(ns.DRIVER_DEDUPE_JACCARD_THRESHOLD).toBe(0.25);
    expect(sweep.PLAUSIBILITY_CAP_MULTIPLE).toBe(2);
  });

  test("isSimilar still honors its own 0.6 line (S6 behavior unchanged)", () => {
    // 근접 쌍(0.7 가정치)은 유사, 0.5 쌍은 isSimilar에서 무유사 — 0.25 드라이버
    // 선과 갈라진다.
    const close = "드론 물류 배송 확대";
    const base = ["드론 물류 배송 확대"];
    expect(ns.isSimilar(close, base)).toBe(true);
    // Jaccard 0.5 실측 쌍(운영비 절감 쌍) — isSimilar(0.6)은 무유사.
    expect(ns.isSimilar("기술 발전과 운영비 절감", ["기술 발전과 도입 비용 절감"])).toBe(false);
  });
});

describe("D-B — filterDuplicateDriverProposals (pre-insert hard filter)", () => {
  test("identical name is dropped (the v12 byte-identical case)", () => {
    const { survivors, dropped } = ns.filterDuplicateDriverProposals(
      [{ driver: "상업용 드론 활용 확대" }],
      OBSERVED_ACCEPTED,
    );
    expect(survivors).toHaveLength(0);
    expect(dropped.map((d) => d.driver)).toEqual(["상업용 드론 활용 확대"]);
  });

  test("observed paraphrase pairs are dropped (Jaccard 0.50 and 0.29)", () => {
    const r = ns.filterDuplicateDriverProposals(
      [{ driver: "기술 발전과 운영비 절감" }, { driver: "상업용 드론 수요 확대" }],
      OBSERVED_ACCEPTED,
    );
    expect(r.survivors).toHaveLength(0);
    expect(r.dropped.map((d) => d.driver)).toEqual(["기술 발전과 운영비 절감", "상업용 드론 수요 확대"]);
  });

  test("distinct mechanism passes; the loose paraphrases honestly survive the lexical filter", () => {
    const r = ns.filterDuplicateDriverProposals(
      [
        { driver: "인공지능 기반 자율 비행 인증 체계 도입" },
        // 어휘 판정 한계 밴드(0.13-0.20) — 이 층은 D-A 프롬프트 블록과 D-C 과잉
        // 신호가 담당한다. 핀은 경계를 문서화하는 것이지 실패가 아니다.
        { driver: "규제 및 운용 여건 개선" },
        { driver: "기술 개선과 운영 효율" },
      ],
      OBSERVED_ACCEPTED,
    );
    expect(r.survivors.map((d) => d.driver)).toEqual([
      "인공지능 기반 자율 비행 인증 체계 도입",
      "규제 및 운용 여건 개선",
      "기술 개선과 운영 효율",
    ]);
    expect(r.dropped).toHaveLength(0);
  });

  test("empty-normalized candidate is never dropped by the dedupe (caller validation owns it)", () => {
    const { survivors, dropped } = ns.filterDuplicateDriverProposals([{ driver: "···" }], OBSERVED_ACCEPTED);
    expect(dropped).toHaveLength(0);
    expect(survivors).toHaveLength(1);
  });

  test("drop counting: mixed batch of 4 (2 duplicates) splits exactly", () => {
    const r = ns.filterDuplicateDriverProposals(
      [
        { driver: "상업용 드론 활용 확대" },
        { driver: "새로운 신규 메커니즘" },
        { driver: "기술 발전과 운영비 절감" },
        { driver: "또 다른 신규 메커니즘" },
      ],
      OBSERVED_ACCEPTED,
    );
    expect(r.survivors.map((d) => d.driver)).toEqual(["새로운 신규 메커니즘", "또 다른 신규 메커니즘"]);
    expect(r.dropped.map((d) => d.driver)).toEqual(["상업용 드론 활용 확대", "기술 발전과 운영비 절감"]);
  });
});

describe("D-C — buildOvershootSignal (honest overshoot math)", () => {
  test("the live case: sum 12.0 > cap 7.8 over needed 3.9 → overshoot true", () => {
    const s = sweep.buildOvershootSignal({
      ourCagrPct: 13,
      externalCagrPct: 16.9,
      acceptedImpacts: [4.0, 4.5, 3.5],
      runStartFeasibleRatio: 0,
    });
    expect(s).not.toBeNull();
    expect(s?.acceptedImpactSumPct).toBe(12);
    expect(s?.neededUpliftPct).toBe(3.9);
    expect(s?.plausibleCapPct).toBe(7.8);
    expect(s?.feasibleRatio).toBe(0);
    expect(s?.overshoot).toBe(true);
  });

  test("boundary: sum exactly at cap is not overshoot (strict >)", () => {
    const s = sweep.buildOvershootSignal({ ourCagrPct: 13, externalCagrPct: 16.9, acceptedImpacts: [3.9, 3.9] });
    expect(s?.acceptedImpactSumPct).toBe(7.8);
    expect(s?.plausibleCapPct).toBe(7.8);
    expect(s?.overshoot).toBe(false);
  });

  test("sum below cap → false", () => {
    const s = sweep.buildOvershootSignal({ ourCagrPct: 10, externalCagrPct: 20, acceptedImpacts: [5, 5] });
    expect(s?.acceptedImpactSumPct).toBe(10);
    expect(s?.plausibleCapPct).toBe(20);
    expect(s?.overshoot).toBe(false);
  });

  test("no CAGR anchor → null (size-based gap has no CAGR overshoot)", () => {
    expect(sweep.buildOvershootSignal({ ourCagrPct: 13, externalCagrPct: 0, acceptedImpacts: [5] })).toBeNull();
    expect(sweep.buildOvershootSignal({ ourCagrPct: 13, externalCagrPct: -3, acceptedImpacts: [5] })).toBeNull();
  });

  test("no run-start sweep → feasibleRatio is honest null while overshoot still computes", () => {
    const s = sweep.buildOvershootSignal({ ourCagrPct: 13, externalCagrPct: 16.9, acceptedImpacts: [4, 4, 4] });
    expect(s?.overshoot).toBe(true);
    expect(s?.feasibleRatio).toBeNull();
  });
});

describe("D-D — selectExclusionArm truth table", () => {
  test("single-culprit overshoot fires the overshoot arm", () => {
    expect(
      sweep.selectExclusionArm({
        worsening: false,
        overshoot: true,
        baselineFeasibleRatio: 0,
        topImprovementPct: 96.6,
      }),
    ).toBe("overshoot");
  });

  test("multi-culprit overshoot (all removals still 0) stays silent", () => {
    expect(
      sweep.selectExclusionArm({ worsening: false, overshoot: true, baselineFeasibleRatio: 0, topImprovementPct: 0 }),
    ).toBeNull();
    expect(
      sweep.selectExclusionArm({
        worsening: false,
        overshoot: true,
        baselineFeasibleRatio: 0,
        topImprovementPct: null,
      }),
    ).toBeNull();
  });

  test("over-cap but still feasible (baseline > 0) proposes nothing on the overshoot arm", () => {
    expect(
      sweep.selectExclusionArm({ worsening: false, overshoot: true, baselineFeasibleRatio: 0.3, topImprovementPct: 5 }),
    ).toBeNull();
  });

  test("the worsening arm is unchanged and takes precedence", () => {
    expect(
      sweep.selectExclusionArm({ worsening: true, overshoot: false, baselineFeasibleRatio: 0.3, topImprovementPct: 5 }),
    ).toBe("worsening");
    expect(
      sweep.selectExclusionArm({ worsening: true, overshoot: false, baselineFeasibleRatio: 0, topImprovementPct: 0 }),
    ).toBe("worsening");
    expect(
      sweep.selectExclusionArm({ worsening: true, overshoot: true, baselineFeasibleRatio: 0, topImprovementPct: 96.6 }),
    ).toBe("worsening");
  });

  test("neither trigger → null", () => {
    expect(
      sweep.selectExclusionArm({
        worsening: false,
        overshoot: false,
        baselineFeasibleRatio: 0,
        topImprovementPct: 96.6,
      }),
    ).toBeNull();
  });
});

describe("D-D — rankExclusionCandidates-driven scenario (the dispatch case)", () => {
  test("single-culprit: baseline 0, one removal restores 0.966 → overshoot arm fires", () => {
    // our 10 / ext 20 → 필요 상향 10, 개연성 상한 20. X=31/Y=5/Z=5(합 41) —
    // 전체 표본 하한 0.5×41=20.5 > 20 → baseline 0. X를 빼면 5+5(하한 5)가
    // 목표선 밴드(합 7~13)에 들어와 0.966로 복구 — 단일 원인 서명.
    const r = sweep.rankExclusionCandidates({
      ourCagrPct: 10,
      externalCagrPct: 20,
      drivers: [
        { driver: "X", direction: "upside", impact_pct: 31 },
        { driver: "Y", direction: "upside", impact_pct: 5 },
        { driver: "Z", direction: "upside", impact_pct: 5 },
      ],
    });
    expect(r.baselineFeasibleRatio).toBe(0);
    expect(r.ranked[0]?.improvementPct).toBeGreaterThan(0);
    const arm = sweep.selectExclusionArm({
      worsening: false,
      overshoot: true,
      baselineFeasibleRatio: r.baselineFeasibleRatio,
      topImprovementPct: r.ranked[0]?.improvementPct ?? null,
    });
    expect(arm).toBe("overshoot");
  });

  test("multi-culprit: baseline 0, every removal still 0 → silent (the D-C signal is the surface)", () => {
    // A/B/C = 21씩(합 63) — 하나를 빼도 하한 0.5×42=21 > 20 → 모든 제거 후에도 0.
    const r = sweep.rankExclusionCandidates({
      ourCagrPct: 10,
      externalCagrPct: 20,
      drivers: [
        { driver: "A", direction: "upside", impact_pct: 21 },
        { driver: "B", direction: "upside", impact_pct: 21 },
        { driver: "C", direction: "upside", impact_pct: 21 },
      ],
    });
    expect(r.baselineFeasibleRatio).toBe(0);
    const maxImprovement = Math.max(...r.ranked.map((c) => c.improvementPct));
    expect(maxImprovement).toBeLessThanOrEqual(0);
    expect(
      sweep.selectExclusionArm({
        worsening: false,
        overshoot: true,
        baselineFeasibleRatio: r.baselineFeasibleRatio,
        topImprovementPct: r.ranked[0]?.improvementPct ?? null,
      }),
    ).toBeNull();
  });
});

describe("static contract — pipeline wiring (normSrc pins)", () => {
  const pipelineRaw = readFileSync(new URL(`${WEB}/lib/market-sizing-pipeline.ts`, import.meta.url), "utf8");
  const pipeline = normSrc(pipelineRaw);
  const has = (snippet: string) => expect(pipeline).toContain(normSrc(snippet));

  test("D-A — the accepted-names advisory block reaches the attribution prompt", () => {
    has("const ACCEPTED_DRIVERS_PROMPT_CAP = 20;");
    has(
      "const acceptedNames = acceptedDrivers .map((d) => d.driver) .filter((n) => n.trim().length > 0) .slice(0, ACCEPTED_DRIVERS_PROMPT_CAP);",
    );
    has('이미 수용된 드라이버: ${acceptedNames.join(" / ")}');
    has("이름만 다른 유사 표현(의역)을 다시 제안하지 마세요. 목록에 없는 새로운 메커니즘만 제안하세요.");
    // 금지 블록은 귀인(attrJson) 프롬프트 말미에만 삽입된다 — 격차 분석(gapJson)
    // 프롬프트는 건드리지 않는다(표시 전용 newDrivers).
    has("rationale은 이번 분석의 리서치 근거나 상식에 근거해 1-2문장.${doNotRepropose}`");
    expect(pipelineRaw.split("${doNotRepropose}").length - 1).toBe(1);
  });

  test("D-B — the hard filter is wired before insert with an honest drop counter", () => {
    has("let droppedDuplicateDrivers = 0;");
    has(
      "const { survivors, dropped } = filterDuplicateDriverProposals( validCandidates, acceptedDrivers.map((d) => d.driver), );",
    );
    has("droppedDuplicateDrivers += dropped.length;");
    has("pendingDriverProposals.push(...survivors.slice(0, 5));");
    // 정직한 요약 — 드롭 건수가 step-5-C 요약에 들어간다(0이면 문구 없음).
    has('droppedDuplicateDrivers > 0 ? ` (수용 드라이버와 중복 ${droppedDuplicateDrivers}건 제외)` : "";');
    has("건 생성${dedupeNote}. 수용은 사람(경계 #2).");
  });

  test("D-C — the calibration block carries the overshoot signal", () => {
    has("overshoot: buildOvershootSignal({");
    has("acceptedImpacts: acceptedDrivers.map((d) => d.impact_pct),");
    has("runStartFeasibleRatio: sweepInject ? sweepInject.feasibleRatio : null");
  });

  test("D-D — the exclusion block widens to worsening||overshoot and selects the arm", () => {
    has("const overshootExclusion = calibration?.overshoot?.overshoot === true && calibration.triggered === true;");
    has("(worseningExclusion || overshootExclusion) &&");
    has("const arm = selectExclusionArm({");
    has("if (arm && top && top.improvementPct > 0) {");
    has("제외 검토 근거 — 수용 집합 과잉:");
    has(
      "권고: 수용 집합이 과잉이며 이 드라이버 하나를 빼면 목표선 도달 조합이 다시 생깁니다. 제외는 사람의 결정으로만 적용됩니다.",
    );
    // 악화 팔의 문구는 바이트 단위로 보존된다.
    has(
      "제외 검토 근거 — 격차 악화: 이전 버전 ${previousGapPct}% → 이번 버전 ${newGapPct}% (허용 편차 ±${EXCLUSION_NOISE_BAND_PCT}%p 초과).",
    );
    has(
      "권고: ${top.driver}을(를) 수용 드라이버에서 제외하면 수렴 가능 조합 비율이 가장 크게 개선됩니다. 제외는 사람의 결정으로만 적용됩니다.",
    );
  });
});

describe("static contract — calibration-sweep source", () => {
  const sweepSrc = normSrc(readFileSync(new URL(`${WEB}/lib/calibration-sweep.ts`, import.meta.url), "utf8"));

  test("the 2x multiple has one source consumed by both sweep and signal", () => {
    expect(sweepSrc).toContain(normSrc("const plausibilityCap = needed * PLAUSIBILITY_CAP_MULTIPLE;"));
    expect(sweepSrc).toContain(
      normSrc("const plausibleCapPct = Math.round(neededUpliftPct * PLAUSIBILITY_CAP_MULTIPLE * 10) / 10;"),
    );
  });
});
