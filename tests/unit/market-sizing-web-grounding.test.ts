/**
 * Quantitative web grounding for the S1 sizing pipeline (design
 * 2026-11-06-s1-quantitative-web-grounding): item-level extraction validation
 * (value + excerpt index range + URL match + sanity bounds), the consensus
 * precedence chain (recorded reference > web extraction > LLM prior > unset),
 * the step 5-B `captured_from='web_research'` single persist, anchor URL
 * grounding for validated entries only, honest one-notch grade upgrades with
 * fallback grades intact, and the ~10-query/launch cost bound — lib-level
 * against scratch SQLite, driven by the same stubbed LLM seam and the
 * network-free web-research override as sizing-matrix-guard.test.ts.
 */
import { test, expect, describe, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-sizing-web-grounding.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_QUEUE_NO_SPAWN = "1";
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

// LLM seam — same mock.module discipline as sizing-matrix-guard.test.ts: the
// originals are snapshotted BY VALUE before the patch, the wrapper is armed
// only inside the pipeline describe, and disarmed it forwards to the
// pre-patch originals (sibling suites keep their env-driven behavior).
// Extraction calls (R2 protocol, identified by the marker in the instruction)
// are dispatched to their own JSON stub so one run can serve the step parsers
// and the extraction contract independently.
const realLlm = await import("../../app/web-next/lib/llm.ts");
const realLlmSnapshot = { ...realLlm };
const realIsLlmConfigured = realLlmSnapshot.isLlmConfigured;
const realCompleteOrFallback = realLlmSnapshot.completeOrFallback;
const EXTRACTION_MARKER = "웹 발췌 정량 추출";
const llmStub: { armed: boolean; json: Record<string, unknown>; extractJson: Record<string, unknown>; prompts: string[] } = {
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
      return realCompleteOrFallback(messages as Parameters<typeof realCompleteOrFallback>[0], fallback as Parameters<typeof realCompleteOrFallback>[1], opts as Parameters<typeof realCompleteOrFallback>[2]);
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
const {
  EXCERPT_VALUE_BOUNDS,
  extractFromExcerpts,
  getQuantSearchQueryCountForTests,
  resetQuantSearchQueryCountForTests,
  resolveTopDownConsensus,
  runSizingPipeline,
  validateExcerptItems,
} = await import("../../app/web-next/lib/market-sizing-pipeline.ts");
const { setWebResearchOverrideForTests } = await import("../../app/web-next/lib/web-research.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();
// Canned search excerpts — the override hands this list to EVERY search call,
// so each quantitative search segment sees the same excerpts. Validated
// extraction items must quote excerpt[0]'s URL back.
const SOURCES = [
  {
    title: "글로벌 리서치 전망 리포트",
    url: "https://example.com/report-1",
    snippet: "2026년 글로벌 시장 규모는 12.8B 달러이며 2030년 42.5B 달러 전망, 연평균 성장률은 8.0%이다.",
  },
  {
    title: "국내 산업 보고서",
    url: "https://example.com/report-2",
    snippet: "국내 시장은 연평균 6.5% 성장이 전망된다.",
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

// ── R2: 항목 단위 검증 규칙 ──
describe("validateExcerptItems — 항목 단위 검증 규칙 (R2)", () => {
  const fields = ["cagr"];

  test("값 존재 + 인덱스 범위 + URL 일치를 모두 충족한 항목만 provenance와 함께 통과", () => {
    const items = validateExcerptItems(
      [{ source_label: "리서치 기관", url: SOURCES[0].url, excerpt_index: 0, cagr: 0.08 }],
      SOURCES,
      fields,
      EXCERPT_VALUE_BOUNDS,
    );
    expect(items).toEqual([{ excerptIndex: 0, label: "리서치 기관", url: SOURCES[0].url, values: { cagr: 0.08 } }]);
  });

  test("범위 밖 발췌 인덱스는 그 항목만 폐기한다(전체 폐기 아님 — 항목 단위 폴백)", () => {
    const items = validateExcerptItems(
      [
        { source_label: "x", url: SOURCES[0].url, excerpt_index: 99, cagr: 0.08 },
        { source_label: "y", url: SOURCES[1].url, excerpt_index: 1, cagr: 0.065 },
      ],
      SOURCES,
      fields,
      EXCERPT_VALUE_BOUNDS,
    );
    expect(items.map((i) => i.excerptIndex)).toEqual([1]);
  });

  test("URL이 해당 발췌와 불일치하면 폐기한다(발췌에 없는 출처의 값 차단)", () => {
    const items = validateExcerptItems(
      [
        { source_label: "위조 출처", url: "https://fabricated.example.com/x", excerpt_index: 0, cagr: 0.08 },
        { source_label: "정합 출처", url: SOURCES[0].url, excerpt_index: 0, cagr: 0.08 },
      ],
      SOURCES,
      fields,
      EXCERPT_VALUE_BOUNDS,
    );
    expect(items.map((i) => i.label)).toEqual(["정합 출처"]);
  });

  test("값 누락과 상식 경계 밖 값(cagr ≥ 1, 음수)은 폐기한다", () => {
    const items = validateExcerptItems(
      [
        { source_label: "a", url: SOURCES[0].url, excerpt_index: 0 },
        { source_label: "b", url: SOURCES[0].url, excerpt_index: 0, cagr: 1.2 },
        { source_label: "c", url: SOURCES[0].url, excerpt_index: 0, cagr: -0.05 },
        { source_label: "d", url: SOURCES[0].url, excerpt_index: 0, cagr: 0.08 },
      ],
      SOURCES,
      fields,
      EXCERPT_VALUE_BOUNDS,
    );
    expect(items.map((i) => i.label)).toEqual(["d"]);
  });

  test("extractFromExcerpts — 발췌가 비면 추출 호출을 아예 발사하지 않는다(검색 공백 날조 금지)", async () => {
    let called = 0;
    const out = await extractFromExcerpts({
      ask: async () => {
        called++;
        return {};
      },
      industry: "테스트 산업",
      purpose: "단위 테스트",
      excerpts: [],
      schemaHint: `{"source_label":"x","url":"y","excerpt_index":0,"cagr":0.08}`,
      numericFields: ["cagr"],
    });
    expect(out).toEqual([]);
    expect(called).toBe(0);
  });
});

// ── R4/R9: 컨센서스 우선순위 해석 (순수 경로) ──
describe("resolveTopDownConsensus — 우선순위(기록 참조 > 웹 추출 > LLM 선험 > 미입력)", () => {
  const ref = { source_label: "Gartner 전망", source_url: "https://example.com/gartner", captured_from: "user", external_cagr_pct: 8.74 };

  test("기록 참조가 웹 추출·LLM 선험보다 우선하고 origin user(원문 URL 포함)를 표기한다", () => {
    const td = resolveTopDownConsensus({
      externalReference: ref,
      llmCagrFrac: 0.09,
      webExtraction: { cagrPct: 7.2, sourceLabel: "웹 출처", sourceUrl: "https://example.com/w" },
    });
    expect(td.topDownCagr).toBe(8.7);
    expect(td.toleranceNote).toContain("사람이 기록한 외부 참조(Gartner 전망, user)");
    expect(td.source).toEqual({ label: "Gartner 전망", url: "https://example.com/gartner", origin: "user" });
  });

  test("웹 추출 성공분이 LLM 선험보다 우선하고 origin web_research + 출처 {label, url}을 표기한다", () => {
    const td = resolveTopDownConsensus({
      externalReference: null,
      llmCagrFrac: 0.09,
      webExtraction: { cagrPct: 7.26, sourceLabel: "웹 출처", sourceUrl: "https://example.com/w" },
    });
    expect(td.topDownCagr).toBe(7.3);
    expect(td.summaryLabel).toBe("7.3% (웹 검색 추출)");
    expect(td.toleranceNote).toContain("웹 검색 발췌에서 추출한 값(웹 출처)");
    expect(td.toleranceNote).toContain("원문 확인 전");
    expect(td.source).toEqual({ label: "웹 출처", url: "https://example.com/w", origin: "web_research" });
  });

  test("웹 추출이 없으면 기존 LLM 선험 경로(문구 불변) — origin llm_prior", () => {
    const td = resolveTopDownConsensus({ externalReference: null, llmCagrFrac: 0.08, llmSourceLabel: "글로벌 기관 전망 평균" });
    expect(td.topDownCagr).toBe(8);
    expect(td.summaryLabel).toBe("8.0%");
    expect(td.toleranceNote).toBe("탑다운 컨센서스는 LLM 지식 기반 추정 — 원문 출처 확인 전. 내부 정합성 확인으로만 사용(독립 검증 아님).");
    expect(td.source).toEqual({ label: "글로벌 기관 전망 평균", origin: "llm_prior" });
  });

  test("미입력은 source를 실지 않는다(0 — 절대 날조하지 않는다)", () => {
    const td = resolveTopDownConsensus({ externalReference: null, llmCagrFrac: null, webExtraction: null });
    expect(td.topDownCagr).toBe(0);
    expect(td.source).toBeUndefined();
  });
});

// ── 파이프라인 수준: 단계별 흐름·열화·저장·등급·비용 상한 ──
describe("runSizingPipeline — 웹 접지 단계별 흐름", () => {
  beforeEach(() => {
    llmStub.armed = true;
    llmStub.prompts.length = 0;
    llmStub.json = {};
    llmStub.extractJson = { items: [] };
    resetQuantSearchQueryCountForTests();
    setWebResearchOverrideForTests({ configured: false, sources: [] });
  });
  afterAll(() => {
    llmStub.armed = false;
    setWebResearchOverrideForTests(null);
    resetQuantSearchQueryCountForTests();
  });

  const REGION_CODES = ["china", "apac_ex_china", "north_america", "europe", "mea", "latam_row"];
  // One completion object satisfies every step parser (same convention as
  // sizing-matrix-guard.test.ts): 6 regions × 2 cells × $1.0B = the stub anchor.
  const stubCompletion = (baseline?: Record<string, Record<string, number>>) => ({
    position: "midstream",
    note: "스텁 — 가치사슬 위치 고정",
    relatedIndustries: [],
    segments: [{ code: "seg_a", label: "세그먼트A" }, { code: "seg_b", label: "세그먼트B" }],
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
    db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)", [aid, indId, "in_progress", "test", NOW]);
    return { aid, industryId: indId };
  };

  const matrixOf = (aid: string): Record<string, any> => {
    const stored = db.query("SELECT payload FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1").get(aid) as { payload: string };
    return (JSON.parse(stored.payload) as { matrix: Record<string, any> }).matrix;
  };

  const referenceRows = (industryId: string): Array<Record<string, any>> =>
    db.query("SELECT * FROM market_external_reference WHERE industry_id = ? ORDER BY version_no DESC").all(industryId) as Array<Record<string, any>>;

  const extractionPrompts = (): string[] => llmStub.prompts.filter((p) => p.includes(EXTRACTION_MARKER));

  test("R1 우선 — 기록 참조가 있으면 컨센서스·전망의 검색/추출/LLM 질의가 모두 생략되고 참조값·user 기원이 유지된다", async () => {
    llmStub.json = stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }])));
    setWebResearchOverrideForTests({ configured: true, sources: SOURCES }); // 검색이 "가능"해도 참조가 이긴다
    const { aid, industryId } = insertAnalysis("참조 우선 접지 스텁 산업");
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
    expect(matrix.consistency.source).toEqual({ label: "분석가 기록 전망", url: "https://example.com/recorded", origin: "user" });
    // 컨센서스 추출(cagr 스키마)·전망 추출(target_year 스키마)·LLM 선험 질의 전부 없음.
    const ext = extractionPrompts();
    expect(ext.some((p) => p.includes("cagr"))).toBe(false);
    expect(ext.some((p) => p.includes("target_year"))).toBe(false);
    expect(llmStub.prompts.join("\n")).not.toContain("공개된 시장 성장률 컨센서스");
    expect(llmStub.prompts.join("\n")).not.toContain("미래 시장 전망치");
    // 재검색 노이즈 없음 — 기록 참조 외 추가 저장 없음(1건 = 시드).
    expect(referenceRows(industryId)).toHaveLength(1);
    // R7 — 참조가 있는 단계(step 5·5-B)의 검색 질의는 발사되지 않는다(앵커 3 + 성장 맥락 2).
    expect(getQuantSearchQueryCountForTests()).toBe(5);
  });

  test("R4 — 기록 참조가 없고 검색이 성공하면 웹 발췌 추출 CAGR이 컨센서스가 되고 출처 {label, url, origin}을 실는다", async () => {
    llmStub.json = stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }])));
    setWebResearchOverrideForTests({ configured: true, sources: SOURCES });
    llmStub.extractJson = { items: [{ source_label: "글로벌 리서치 전망 리포트", url: SOURCES[0].url, excerpt_index: 0, cagr: 0.08 }] };
    const { aid, industryId } = insertAnalysis("웹 컨센서스 접지 스텁 산업");
    await expect(runSizingPipeline(db, aid)).resolves.toBeUndefined();
    const matrix = matrixOf(aid);
    expect(matrix.consistency.topDownCagr).toBe(8.0);
    expect(matrix.consistency.source).toEqual({ label: "글로벌 리서치 전망 리포트", url: SOURCES[0].url, origin: "web_research" });
    expect(matrix.consistency.tolerance).toContain("원문 확인 전");
    // 웹 추출이 성공했으므로 LLM 선험 컨센서스 질의는 발사되지 않는다.
    expect(llmStub.prompts.join("\n")).not.toContain("공개된 시장 성장률 컨센서스");
    // 컨센서스는 consistency.source로만 표기되고 별도 저장하지 않는다(설계: R9 표기 중복 방지).
    expect(referenceRows(industryId)).toHaveLength(0);
    // R7 — 4단계 모두 검색: 3+2+2+3 = 10회 상한.
    expect(getQuantSearchQueryCountForTests()).toBe(10);
  });

  test("R7 열화 — 검색이 공백(또는 쿼터 초과)이면 추출 호출 0회, 기존 LLM 선험 경로·등급이 그대로다", async () => {
    llmStub.json = stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }])));
    setWebResearchOverrideForTests({ configured: true, sources: [] }); // 검색 가능하지만 결과 0건
    const { aid, industryId } = insertAnalysis("검색 공백 열화 스텁 산업");
    await expect(runSizingPipeline(db, aid)).resolves.toBeUndefined();
    const matrix = matrixOf(aid);
    // 발췌가 없으므로 추출 호출이 아예 없다(날조 금지).
    expect(extractionPrompts()).toHaveLength(0);
    // 기존 LLM 선험 경로 그대로: 컨센서스·전망 질의 모두 발사, 스텁에 값이 없어 미입수.
    expect(llmStub.prompts.join("\n")).toContain("공개된 시장 성장률 컨센서스");
    expect(llmStub.prompts.join("\n")).toContain("미래 시장 전망치");
    expect(matrix.consistency.topDownCagr).toBe(0);
    expect(matrix.consistency.source).toBeUndefined();
    // 폴백 등급 유지 (R8).
    const anchor = (matrix.sectionConfidence ?? []).find((s: { section: string }) => s.section === "기준 시장규모 (앵커)");
    const cagr = (matrix.sectionConfidence ?? []).find((s: { section: string }) => s.section === "셀별 CAGR");
    expect(anchor.grade).toBe("C");
    expect(anchor.note).toBe("LLM 추정 다중 소스 — 벤더 리포트 원문 대조 전");
    expect(cagr.grade).toBe("C-");
    // 저장 없음 — 전망도 컨센서스도 web_research/llm_prior 참조를 남기지 않는다.
    expect(referenceRows(industryId)).toHaveLength(0);
  });

  test("R2 계약 위반 — 추출 출력의 발췌 인덱스가 범위 밖이면 항목이 폐기되고 LLM 선험으로 폴백한다", async () => {
    llmStub.json = stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }])));
    setWebResearchOverrideForTests({ configured: true, sources: SOURCES });
    llmStub.extractJson = { items: [{ source_label: "x", url: SOURCES[0].url, excerpt_index: 99, cagr: 0.08 }] };
    const { aid } = insertAnalysis("계약 위반 폴백 스텁 산업");
    await expect(runSizingPipeline(db, aid)).resolves.toBeUndefined();
    const matrix = matrixOf(aid);
    // 추출 호출은 발사됐지만 통과 항목이 없어 컨센서스는 기존 LLM 선험 경로로 폴백.
    expect(extractionPrompts().some((p) => p.includes("cagr"))).toBe(true);
    expect(llmStub.prompts.join("\n")).toContain("공개된 시장 성장률 컨센서스");
    expect(matrix.consistency.topDownCagr).toBe(0);
    expect(matrix.consistency.source).toBeUndefined();
  });

  test("R9 — step 5-B 웹 추출 전망은 captured_from='web_research'로 1회 저장되고 sourceUrl을 실는다", async () => {
    llmStub.json = stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }])));
    setWebResearchOverrideForTests({ configured: true, sources: SOURCES });
    llmStub.extractJson = { items: [{ source_label: "글로벌 리서치 전망 리포트", url: SOURCES[0].url, excerpt_index: 0, target_year: 2030, size_b: 42.5 }] };
    const { aid, industryId } = insertAnalysis("웹 전망 저장 스텁 산업");
    await expect(runSizingPipeline(db, aid)).resolves.toBeUndefined();
    const matrix = matrixOf(aid);
    const rows = referenceRows(industryId);
    expect(rows).toHaveLength(1); // 1회 저장 — 중복 없음
    expect(rows[0].captured_from).toBe("web_research");
    expect(rows[0].source_url).toBe(SOURCES[0].url);
    expect(rows[0].target_year).toBe(2030);
    expect(rows[0].external_size_b).toBeCloseTo(42.5, 5);
    expect(matrix.externalForecast.sourceLabel).toBe("글로벌 리서치 전망 리포트");
    expect(matrix.externalForecast.sourceUrl).toBe(SOURCES[0].url);
    expect(matrix.externalForecast.targetYear).toBe(2030);
    expect(matrix.externalForecast.marketSize).toBeCloseTo(42.5, 5);
    expect(matrix.externalForecast.note).toContain("웹 검색 발췌");
    // 웹 추출이 성공했으므로 LLM 선험 전망 질의는 발사되지 않는다.
    expect(llmStub.prompts.join("\n")).not.toContain("미래 시장 전망치");
  });

  test("R3 — 앵커 URL 접지는 추출 검증을 통과한 항목에만 붙고, 등급은 한 계단 상승한다(R8)", async () => {
    llmStub.json = stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }])));
    setWebResearchOverrideForTests({ configured: true, sources: SOURCES });
    // 검증 통과 1건(인덱스 0·URL 일치) + 위반 2건(범위 밖 인덱스·URL 불일치) — 통과분만 반영된다.
    llmStub.extractJson = {
      items: [
        { source_label: "글로벌 리서치 전망 리포트", url: SOURCES[0].url, excerpt_index: 0, size_b: 12.8, year: 2026 },
        { source_label: "범위 밖", url: SOURCES[1].url, excerpt_index: 7, size_b: 3.0, year: 2026 },
        { source_label: "URL 불일치", url: "https://fabricated.example.com/x", excerpt_index: 1, size_b: 4.0, year: 2026 },
      ],
    };
    const { aid } = insertAnalysis("앵커 접지 등급 스텁 산업");
    await expect(runSizingPipeline(db, aid)).resolves.toBeUndefined();
    const matrix = matrixOf(aid);
    const withUrl = (matrix.anchor.sources as Array<{ sourceUrl?: string; label: string; note: string }>).filter((s) => s.sourceUrl);
    expect(withUrl).toHaveLength(1);
    expect(withUrl[0].sourceUrl).toBe(SOURCES[0].url);
    expect(withUrl[0].label).toBe("글로벌 리서치 전망 리포트");
    expect(withUrl[0].note).toContain("원문 확인 전");
    const anchor = (matrix.sectionConfidence ?? []).find((s: { section: string }) => s.section === "기준 시장규모 (앵커)");
    expect(anchor.grade).toBe("B-");
    expect(anchor.note).toBe("웹 검색 1건 기반 — 원문 확인 전");
    // R6 — 성장 전망 발췌(2건)가 맥락으로 주입된 단계: 셀별 CAGR은 C-→C 한 계단.
    const cagr = (matrix.sectionConfidence ?? []).find((s: { section: string }) => s.section === "셀별 CAGR");
    expect(cagr.grade).toBe("C");
    expect(cagr.note).toBe("웹 검색 2건 기반 — 원문 확인 전");
    // R6 — 셀 값은 여전히 LLM+보정 제약 산출(셀 값에 provenance 없음), 발췌는 맥락 블록으로만 존재.
    expect(llmStub.prompts.join("\n")).toContain("[산업 성장 전망 발췌 — 참고 맥락 전용]");
    expect(llmStub.prompts.join("\n")).toContain("셀별 CAGR 값을 이 발췌에서 그대로 배정하지 말 것");
  });

  test("R7 비용 상한 — 정량 단계 검색 질의는 런당 최대 ~10회(단계별 2~3개)", async () => {
    llmStub.json = stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }])));
    setWebResearchOverrideForTests({ configured: true, sources: SOURCES });
    const { aid } = insertAnalysis("비용 상한 스텁 산업");
    await expect(runSizingPipeline(db, aid)).resolves.toBeUndefined();
    // step 2(3) + step 4(2) + step 5(2) + step 5-B(3) = 10 — 상한 준수.
    expect(getQuantSearchQueryCountForTests()).toBe(10);
    // 추출 호출은 단계당 1회 상한 — 4단계 중 추출이 발사되는 step 2/5/5-B의 3회.
    expect(extractionPrompts()).toHaveLength(3);
  });
});
