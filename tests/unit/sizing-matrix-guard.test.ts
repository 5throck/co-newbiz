/** Incomplete-matrix guard + demo seed shape (S1 report crash, 2026-10-09).
 *  Also covers the zero-baseline fail-closed guard (DEC-20261104-06 item A):
 *  the helper unit tests plus the §6 T1/T2 pipeline-level runs, driven by a
 *  stubbed LLM seam (mocked llm module — degenerate completion, no network). */
import { test, expect, describe, afterAll, beforeEach, mock } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-sizing-matrix-guard.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_QUEUE_NO_SPAWN = "1";
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const realLlm = await import("../../app/web-next/lib/llm.ts");
// Snapshot the originals BY VALUE before mock.module: bun patches the module
// namespace in place, so `realLlm.fn()` inside the wrapper would dereference
// the patched export and recurse forever (verified: Maximum call stack size
// exceeded). The wrapper is ARMED only inside the pipeline describe
// (beforeEach/afterAll) — bun test runs sibling files in one process, so an
// always-on patch would leak the stub into the offline suites; disarmed, it
// forwards to these pre-patch originals and is behaviorally invisible.
const realLlmSnapshot = { ...realLlm };
const realIsLlmConfigured = realLlmSnapshot.isLlmConfigured;
const realCompleteOrFallback = realLlmSnapshot.completeOrFallback;
// Mutable stub — each test swaps the completion object the seam returns.
const llmStub: { armed: boolean; json: Record<string, unknown> } = { armed: false, json: {} };
mock.module("../../app/web-next/lib/llm.ts", () => ({
  ...realLlmSnapshot,
  isLlmConfigured: () => (llmStub.armed ? true : realIsLlmConfigured()),
  completeOrFallback: (messages: unknown, fallback: unknown, opts?: { maxTokens?: number }) =>
    llmStub.armed
      ? Promise.resolve({
          source: "llm" as const,
          text: opts?.maxTokens === 400 ? "스텁 단계 요약 — 테스트 고정문" : JSON.stringify(llmStub.json),
        })
      : realCompleteOrFallback(messages as Parameters<typeof realCompleteOrFallback>[0], fallback as Parameters<typeof realCompleteOrFallback>[1], opts as Parameters<typeof realCompleteOrFallback>[2]),
}));

const { resetDb, getDb } = await import("../../db/client.ts");
const { seedS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { isCompleteSizingMatrix, global2026, projection2030 } = await import("../../app/web-next/lib/market-sizing.ts");
const { assertUsableBaseline, runSizingPipeline } = await import("../../app/web-next/lib/market-sizing-pipeline.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { setWebResearchOverrideForTests } = await import("../../app/web-next/lib/web-research.ts");

describe("isCompleteSizingMatrix", () => {
  test("rejects the old demo shape and non-objects", () => {
    const old = { tam_krw_m: 120000, cagr: 0.13, competitive: { concentration: "moderate", key_players: ["A"] } };
    expect(isCompleteSizingMatrix(old)).toBe(false);
    expect(isCompleteSizingMatrix(null)).toBe(false);
    expect(isCompleteSizingMatrix(undefined)).toBe(false);
    expect(isCompleteSizingMatrix({ regions: [] })).toBe(false);
  });
});

// DEC-20261104-06 item A — an LLM baseline that parses to zero (rawTotal ≤ 0
// at parse time, or totalNow ≤ 0 after the fallback/scale) must fail the run
// through the pipeline's existing failure path, never persist an all-zero
// matrix version. The guard is the smallest deterministic seam: the pipeline
// path (stubbed LLM completions + full schema) is out of proportion here.
describe("assertUsableBaseline — zero-baseline fail-closed guard (item A)", () => {
  test("rawTotal ≤ 0 or totalNow ≤ 0 throws the user-readable retry guidance", () => {
    const msg = "기준선 매트릭스가 전부 0으로 해석되어 분석을 완료하지 못했습니다 — 재분석으로 재시도하세요";
    expect(() => assertUsableBaseline(0, 0)).toThrow(msg); // explicit zeros + folded cells
    expect(() => assertUsableBaseline(0, 37.5)).toThrow(msg); // scale=0 path → cells stay 0
    expect(() => assertUsableBaseline(37.5, 0)).toThrow(msg); // post-fallback total still 0
    expect(() => assertUsableBaseline(-3, 5)).toThrow(msg); // negative LLM cells
  });

  test("positive totals pass — healthy (incl. ±15% reconciled) baselines are unaffected", () => {
    expect(() => assertUsableBaseline(37.5, 37.489)).not.toThrow(); // rounding drift after reconciliation
    expect(() => assertUsableBaseline(0.4, 0.4)).not.toThrow(); // small but non-degenerate market
  });

  test("the guard is wired into Step 4 after reconciliation, before any version persist — and only for parsed LLM completions (offline skeleton mode keeps its D-2 contract)", () => {
    const src = readFileSync("app/web-next/lib/market-sizing-pipeline.ts", "utf8");
    expect(src).toContain("if (cagrJson !== null) assertUsableBaseline(rawTotal, totalNow)");
    const call = src.indexOf("if (cagrJson !== null) assertUsableBaseline(rawTotal, totalNow)");
    const persist = src.indexOf("INSERT INTO market_sizing_version");
    expect(call).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(call);
  });
});

// §6 T1/T2 (DEC-20261104-06) — the guard at PIPELINE level, driven the same way
// the wave-c3 offline suites drive runSizingPipeline, with the LLM seam swapped
// from null (synthesis skeleton) to a PARSED degenerate completion: the guard's
// carve-out (cagrJson !== null) is exactly what must fire here. A healthy
// completion completes and stores a sane bottomUpCagr (T2) — the guard fires
// only on the degenerate condition.
describe("runSizingPipeline — zero-baseline fail-closed (§6 T1/T2)", () => {
  // Fixed past date (same convention as synergy-rescore.test.ts) so the demo
  // seed describe's newest-version query always sorts the seeder's rows first.
  const NOW = "2026-10-18T00:00:00Z";
  // The armed window is this describe only: the stub forces parsed completions
  // regardless of ambient .env config, and the web-research test override (the
  // seam those suites use) keeps the healthy T2 run offline. Both are released
  // on exit so sibling suites keep their env-driven behavior — no env mutation.
  beforeEach(() => {
    llmStub.armed = true;
    setWebResearchOverrideForTests({ configured: false, sources: [] });
  });
  afterAll(() => {
    llmStub.armed = false;
    setWebResearchOverrideForTests(null);
  });
  const REGION_CODES = ["china", "apac_ex_china", "north_america", "europe", "mea", "latam_row"];
  // Resolved per test — the demo-seed describe's collection-time resetDb()
  // closes and reopens the connection after this describe's callback ran.
  const db = () => getDb(TEST_DB_PATH);

  // One completion object satisfies every Step parser: Steps 5-B..8 read keys
  // this stub omits and fall back exactly like the offline (null) path does.
  const stubCompletion = (baseline: Record<string, Record<string, number>> | undefined) => ({
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

  const insertAnalysis = (nameKo: string): string => {
    const indId = ulid();
    db().run("INSERT INTO md_industry (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", [indId, nameKo, nameKo, NOW]);
    const aid = ulid();
    db().run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)", [aid, indId, "in_progress", "test", NOW]);
    return aid;
  };

  const versionCount = (aid: string): number =>
    (db().query("SELECT COUNT(*) c FROM market_sizing_version WHERE analysis_id = ?").get(aid) as { c: number }).c;

  const analysisRow = (aid: string) =>
    db().query("SELECT status, error_message FROM market_sizing_analysis WHERE id = ?").get(aid) as { status: string; error_message: string | null };

  test("§6 T1 case 1 — all cells explicit 0: status failed, error_message set, NO version persisted", async () => {
    llmStub.json = stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 0, seg_b: 0 }])));
    const aid = insertAnalysis("제로 기준선 스텁 산업");
    await expect(runSizingPipeline(db(), aid)).rejects.toThrow("기준선 매트릭스가 전부 0으로 해석되어");
    const row = analysisRow(aid);
    expect(row.status).toBe("failed");
    expect(row.error_message).toContain("재분석으로 재시도");
    expect(versionCount(aid)).toBe(0);
  });

  test("§6 T1 case 2 — baseline key dropped entirely (cells fold to 0): same fail-closed outcome", async () => {
    llmStub.json = stubCompletion(undefined);
    const aid = insertAnalysis("기준선 누락 스텁 산업");
    await expect(runSizingPipeline(db(), aid)).rejects.toThrow("기준선 매트릭스가 전부 0으로 해석되어");
    const row = analysisRow(aid);
    expect(row.status).toBe("failed");
    expect((row.error_message ?? "").length).toBeGreaterThan(0);
    expect(versionCount(aid)).toBe(0);
  });

  test("§6 T2 — a healthy baseline (sums to the anchor) still completes and stores a sane bottomUpCagr", async () => {
    // 6 regions × 2 cells × $1.0B = $12B = the stub anchor — scale ≈ 1, guard silent.
    llmStub.json = stubCompletion(Object.fromEntries(REGION_CODES.map((r) => [r, { seg_a: 1.0, seg_b: 1.0 }])));
    const aid = insertAnalysis("건전 기준선 스텁 산업");
    await expect(runSizingPipeline(db(), aid)).resolves.toBeUndefined();
    const row = analysisRow(aid);
    expect(row.status).toBe("completed");
    expect(row.error_message).toBeNull();
    const stored = db().query("SELECT payload FROM market_sizing_version WHERE analysis_id = ?").get(aid) as { payload: string };
    const matrix = (JSON.parse(stored.payload) as { matrix: { baseline2026: Record<string, Record<string, number>>; consistency: { bottomUpCagr: number } } }).matrix;
    const total = Object.values(matrix.baseline2026).flatMap((cells) => Object.values(cells)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(12, 0);
    // every stub cell CAGR 0.05 → bottom-up rollup ≈ 5.0 pct points (not the degenerate −100)
    expect(matrix.consistency.bottomUpCagr).toBeCloseTo(5, 1);
  });
});

describe("demo seed", () => {
  resetDb();
  const demo = seedS1ToS12Demo(TEST_DB_PATH, { humanDecisions: false });
  const db = getDb(TEST_DB_PATH);
  const row = db.query("SELECT payload FROM market_sizing_version WHERE id IS NOT NULL ORDER BY created_at DESC LIMIT 1").get() as { payload: string };
  const matrix = (JSON.parse(row.payload) as { matrix: unknown }).matrix;

  test("seeded payload passes the guard and report helpers run", () => {
    expect(isCompleteSizingMatrix(matrix)).toBe(true);
    if (!isCompleteSizingMatrix(matrix)) return;
    expect(matrix.regions.length).toBeGreaterThanOrEqual(2);
    expect((matrix.segments ?? []).length).toBeGreaterThanOrEqual(2);
    expect(global2026(matrix).total).toBeGreaterThan(0);
    expect(Object.keys(projection2030(matrix))).toHaveLength(matrix.regions.length);
  });

  test("S1 predicate still reads the competitive structure", () => {
    const missing = evaluateProcess({ type: "opportunity", id: demo.opportunityId }).requiredArtifacts;
    expect(missing).not.toContain("경쟁 구조");
  });
});
