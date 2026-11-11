/**
 * S1 growth-consensus staleness (design 2026-09-18-s1-growth-gap-calibration,
 * amendment 2026-11-12): the staleness comparator (recorded external reference
 * newer than the displayed analysis version), the rerun-CTA visibility modes
 * (gap-gated / staleness-gated / both / neither), the pipeline fallback fix —
 * a size-only (CAGR 0) auto-saved reference no longer suppresses the web/LLM
 * consensus fallback, and the CAGR-bearing reference path is unchanged —
 * lib-level against scratch SQLite, driven by the same stubbed LLM seam and
 * the network-free web-research override as market-sizing-web-grounding.test.ts.
 */
import { test, expect, describe, afterAll, beforeEach, mock } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-growth-staleness.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_QUEUE_NO_SPAWN = "1";
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

// LLM seam — same mock.module discipline as market-sizing-web-grounding.test.ts.
const realLlm = await import("../../app/web-next/lib/llm.ts");
const realLlmSnapshot = { ...realLlm };
const realIsLlmConfigured = realLlmSnapshot.isLlmConfigured;
const realCompleteOrFallback = realLlmSnapshot.completeOrFallback;
const EXTRACTION_MARKER = "웹 발췌 정량 추출";
const llmStub: {
  armed: boolean;
  json: Record<string, unknown>;
  extractJson: Record<string, unknown>;
  prompts: string[];
} = {
  armed: false,
  json: {},
  extractJson: { items: [] },
  prompts: [],
};
mock.module("../../app/web-next/lib/llm.ts", () => ({
  ...realLlmSnapshot,
  isLlmConfigured: () => (llmStub.armed ? true : realIsLlmConfigured()),
  completeOrFallback: (messages: unknown, fallback: unknown, opts?: { maxTokens?: number }) => {
    if (!llmStub.armed) {
      return realCompleteOrFallback(
        messages as Parameters<typeof realCompleteOrFallback>[0],
        fallback as Parameters<typeof realCompleteOrFallback>[1],
        opts as Parameters<typeof realCompleteOrFallback>[2],
      );
    }
    const text = JSON.stringify(messages);
    llmStub.prompts.push(text);
    if (text.includes(EXTRACTION_MARKER)) {
      return Promise.resolve({ source: "llm" as const, text: JSON.stringify(llmStub.extractJson) });
    }
    return Promise.resolve({
      source: "llm" as const,
      text: opts?.maxTokens === 400 ? "스텁 단계 요약 — 테스트 고정문" : JSON.stringify(llmStub.json),
    });
  },
}));

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { appendExternalReference } = await import("../../app/web-next/lib/market-calibration.ts");
const { runSizingPipeline } = await import("../../app/web-next/lib/market-sizing-pipeline.ts");
const { setWebResearchOverrideForTests } = await import("../../app/web-next/lib/web-research.ts");
const { referenceNewerThanVersion, rerunCtaMode } = await import(
  "../../app/web-next/components/stages/market/SizingGrowthTabs.tsx"
);
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();
const SOURCES = [
  {
    title: "글로벌 리서치 전망 리포트",
    url: "https://example.com/report-1",
    snippet: "2026년 글로벌 시장 규모는 12.8B 달러이며 2030년 42.5B 달러 전망, 연평균 성장률은 8.0%이다.",
  },
];

afterAll(async () => {
  resetDb();
  setWebResearchOverrideForTests(null);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

// ── C1: staleness comparator ──
describe("referenceNewerThanVersion — 참조 기록 시각 vs 표시 버전 생성 시각", () => {
  test("reference newer than the version is stale (banner)", () => {
    expect(referenceNewerThanVersion("2026-11-11T13:37:00.000Z", "2026-11-09T08:18:00.000Z")).toBe(true);
  });

  test("reference older than the version is not stale (reference already reflected)", () => {
    expect(referenceNewerThanVersion("2026-11-09T08:46:00.000Z", "2026-11-11T13:37:00.000Z")).toBe(false);
  });

  test("equal timestamps are not stale", () => {
    const ts = "2026-11-11T13:37:00.000Z";
    expect(referenceNewerThanVersion(ts, ts)).toBe(false);
  });

  test("missing or unparseable inputs fail closed to not-stale", () => {
    expect(referenceNewerThanVersion(null, NOW)).toBe(false);
    expect(referenceNewerThanVersion(NOW, undefined)).toBe(false);
    expect(referenceNewerThanVersion("", "")).toBe(false);
    expect(referenceNewerThanVersion("not-a-date", NOW)).toBe(false);
    expect(referenceNewerThanVersion(NOW, "not-a-date")).toBe(false);
  });
});

// ── C2: rerun CTA visibility modes ──
describe("rerunCtaMode — 격차 게이트·staleness 조합별 CTA 표시", () => {
  test("gap-gated only — the existing gap block owns the CTA", () => {
    expect(rerunCtaMode(25, false)).toBe("gap");
  });

  test("staleness-gated only — CTA appears without externalForecast/gap", () => {
    expect(rerunCtaMode(undefined, true)).toBe("staleness");
    // small gap below the 20% gate — still staleness-driven
    expect(rerunCtaMode(5, true)).toBe("staleness");
  });

  test("both — gap block keeps its CTA (no duplicate button)", () => {
    expect(rerunCtaMode(25, true)).toBe("gap");
  });

  test("neither — no CTA", () => {
    expect(rerunCtaMode(undefined, false)).toBe("none");
    expect(rerunCtaMode(19.9, false)).toBe("none");
  });
});

// ── C3: pipeline fallback ──
describe("runSizingPipeline — size-only 참조가 컨센서스 폴백을 막지 않는다 (C3)", () => {
  const REGION_CODES = ["china", "apac_ex_china", "north_america", "europe", "mea", "latam_row"];
  const stubCompletion = (baseline?: Record<string, Record<string, number>>) => ({
    position: "midstream",
    note: "스텁 — 가치사슬 위치 고정",
    relatedIndustries: [],
    segments: [
      { code: "seg_a", label: "세그먼트A" },
      { code: "seg_b", label: "세그먼트B" },
    ],
    sources: [{ label: "스텁 소스", estimate: 12, status: "consensus", methodology: "테스트 고정 앵커" }],
    regions: [{ code: "china", weight: 100, mix: { seg_a: 50, seg_b: 50 }, adjustment: "스텁 배분" }],
    ...(baseline === undefined ? {} : { baseline }),
    cagr: Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 0.05, seg_b: 0.05 }])),
    overrides: [],
  });

  const insertAnalysis = (nameKo: string): { aid: string; industryId: string } => {
    const indId = ulid();
    db.run("INSERT INTO md_industry (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", [indId, nameKo, nameKo, NOW]);
    const aid = ulid();
    db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)", [
      aid,
      indId,
      "in_progress",
      "test",
      NOW,
    ]);
    return { aid, industryId: indId };
  };

  type MatrixShape = {
    consistency: { topDownCagr: number; source?: { label: string; url?: string; origin: string }; tolerance?: string };
  };
  const matrixOf = (aid: string): MatrixShape => {
    const stored = db
      .query("SELECT payload FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1")
      .get(aid) as { payload: string };
    return (JSON.parse(stored.payload) as { matrix: MatrixShape }).matrix;
  };

  const seedSizeOnlyReference = (industryId: string): void => {
    // 파이프라인이 자동 저장하는 규모 기준(web_research) 참조 — external_cagr_pct 0.
    appendExternalReference(db, {
      industry_id: industryId,
      source_label: "웹 검색 발췌 전망",
      source_url: "https://example.com/size-only",
      target_year: 2030,
      external_cagr_pct: 0,
      external_size_b: 42.5,
      captured_from: "web_research",
      created_by: "market-sizing-pipeline",
    });
  };

  beforeEach(() => {
    llmStub.armed = true;
    llmStub.prompts.length = 0;
    llmStub.json = {};
    llmStub.extractJson = { items: [] };
    setWebResearchOverrideForTests({ configured: false, sources: [] });
  });
  afterAll(() => {
    llmStub.armed = false;
    setWebResearchOverrideForTests(null);
  });

  test("size-only reference + successful web extraction → web/LLM fallback runs and the consensus is not permanently zero", async () => {
    llmStub.json = stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }])));
    setWebResearchOverrideForTests({ configured: true, sources: SOURCES });
    llmStub.extractJson = {
      items: [{ source_label: "글로벌 리서치 전망 리포트", url: SOURCES[0].url, excerpt_index: 0, cagr: 0.08 }],
    };
    const { aid, industryId } = insertAnalysis("규모 전용 참조 웹 폴백 스텁 산업");
    seedSizeOnlyReference(industryId);
    await expect(runSizingPipeline(db, aid)).resolves.toBeUndefined();
    const matrix = matrixOf(aid);
    expect(matrix.consistency.topDownCagr).toBe(8.0);
    expect(matrix.consistency.source).toEqual({
      label: "글로벌 리서치 전망 리포트",
      url: SOURCES[0].url,
      origin: "web_research",
    });
    // 폴백 게이트가 발사됐다 — step 5 컨센서스 추출이 억제되지 않는다
    // (step 2 앵커 추출 + step 5 컨센서스 추출 = 2회. 기존 존재-전용 게이트면 1회).
    expect(llmStub.prompts.filter((p) => p.includes(EXTRACTION_MARKER))).toHaveLength(2);
  });

  test("size-only reference + search blank → the LLM prior consensus query runs and the consensus comes from it", async () => {
    llmStub.json = {
      ...stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }]))),
      cagr: 0.075,
      sourceLabel: "글로벌 기관 전망 평균",
    };
    setWebResearchOverrideForTests({ configured: true, sources: [] });
    const { aid, industryId } = insertAnalysis("규모 전용 참조 LLM 폴백 스텁 산업");
    seedSizeOnlyReference(industryId);
    await expect(runSizingPipeline(db, aid)).resolves.toBeUndefined();
    const matrix = matrixOf(aid);
    expect(matrix.consistency.topDownCagr).toBe(7.5);
    expect(matrix.consistency.source).toEqual({ label: "글로벌 기관 전망 평균", origin: "llm_prior" });
    expect(llmStub.prompts.join("\n")).toContain("공개된 시장 성장률 컨센서스");
    // 컨센서스는 consistency.source로만 표기 — size-only 참조 외 추가 저장 없음.
    const rows = db
      .query("SELECT COUNT(*) AS n FROM market_external_reference WHERE industry_id = ?")
      .get(industryId) as { n: number };
    expect(rows.n).toBe(1);
  });

  test("CAGR-bearing reference path unchanged — the consensus still equals the reference and no fallback runs", async () => {
    llmStub.json = stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }])));
    setWebResearchOverrideForTests({ configured: true, sources: SOURCES });
    const { aid, industryId } = insertAnalysis("CAGR 참조 불변 스텁 산업");
    appendExternalReference(db, {
      industry_id: industryId,
      source_label: "분석가 기록 전망",
      source_url: "https://example.com/recorded",
      target_year: 2030,
      external_cagr_pct: 8.7,
      captured_from: "user",
      created_by: "test",
    });
    await expect(runSizingPipeline(db, aid)).resolves.toBeUndefined();
    const matrix = matrixOf(aid);
    expect(matrix.consistency.topDownCagr).toBe(8.7);
    expect(matrix.consistency.source).toEqual({
      label: "분석가 기록 전망",
      url: "https://example.com/recorded",
      origin: "user",
    });
    // 폴백 미발사 — 웹 컨센서스 추출·LLM 선험 질의 모두 없음.
    expect(llmStub.prompts.join("\n")).not.toContain("웹 발췌 성장률 컨센서스 추출");
    expect(llmStub.prompts.join("\n")).not.toContain("공개된 시장 성장률 컨센서스");
  });
});
