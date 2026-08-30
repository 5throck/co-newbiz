// Market-sizing analysis pipeline — executes the systematic-market-sizing
// skill's 8 steps (with 4-A folded into the step set) for one industry and
// records progress on the market_sizing_analysis row. Per-step summaries use
// the multi-provider LLM when configured, falling back to deterministic
// synthesis (lib/llm.ts); both are tagged so a reader knows the provenance.
// Quantitative data comes from persisted tables only (chain_node_sensitivity,
// structure_simulation_result, fact_market_observation) — the pipeline never
// invents market figures; cells without data are emitted as "수동 확정 필요".

import type { Database } from "bun:sqlite";
import { ulid } from "../../../db/lib/ulid.ts";
import { completeOrFallback } from "./llm.ts";

export const PIPELINE_STEPS = [
  { no: 1, title: "축·프록시 구조 정의" },
  { no: 2, title: "기준 시장규모 산정 (다중 소스 교차)" },
  { no: 3, title: "권역·세그먼트 배분" },
  { no: 4, title: "셀별 CAGR·시나리오 밴드" },
  { no: 5, title: "성장률 정합성 확인" },
  { no: 6, title: "기업 공시 교차검증" },
  { no: 7, title: "분석 한계 목록" },
  { no: 8, title: "가정 레지스트리 등록" },
] as const;

const REGIONS = ["china", "apac_ex_china", "north_america", "europe", "mea", "latam_row"] as const;
const SEGMENTS = ["construction", "mining", "other"] as const;

export interface StepOutput {
  step: number;
  title: string;
  summary: string;
  source: "llm" | "synthesis";
  data: Record<string, unknown>;
  pendingInputs: string[];
}

export async function runSizingPipeline(db: Database, analysisId: string): Promise<void> {
  const analysis = db
    .query(
      `SELECT a.id, a.industry_id, i.name_ko, i.ksic_code
       FROM market_sizing_analysis a JOIN md_industry i ON i.id = a.industry_id
       WHERE a.id = ?`,
    )
    .get(analysisId) as
    | { id: string; industry_id: string; name_ko: string; ksic_code: string | null }
    | null;
  if (!analysis) throw new Error(`analysis ${analysisId} not found`);

  const now = () => new Date().toISOString();

  // ── Step 1: axes + proxy structure (from persisted driver data) ──
  await advance(db, analysis.id, 1);
  const sensitivities = db
    .query(
      `SELECT d.label_ko AS driver_label, cs.sensitivity, cs.region_code, cs.segment_code
       FROM chain_node_sensitivity cs JOIN industry_driver d ON d.id = cs.driver_id
       WHERE cs.industry_id = ?`,
    )
    .all(analysis.industry_id) as Array<{ driver_label: string; sensitivity: number; region_code: string | null; segment_code: string | null }>;
  const keyDrivers = [...new Set(sensitivities.filter((s) => Math.abs(s.sensitivity) >= 0.3).map((s) => s.driver_label))];
  const steps: StepOutput[] = [];
  steps.push(
    await stepOutput(1, "축·프록시 구조 정의", analysis.name_ko, {
      keyDriverCount: keyDrivers.length,
      keyDrivers,
      sensitivityNodeCount: sensitivities.length,
    }, [`권역 축 정의(중국 분리 여부 등)는 분석가 확정 필요`]));

  // ── Step 2: anchor triangulation (no data → pending manual anchors) ──
  await advance(db, analysis.id, 2);
  const seriesCount = db
    .query("SELECT COUNT(DISTINCT series_id) c FROM fact_market_observation")
    .get() as { c: number };
  steps.push(
    await stepOutput(2, "기준 시장규모 산정 (다중 소스 교차)", analysis.name_ko, {
      observationSeries: seriesCount.c,
      anchor: null,
    }, ["최소 2개의 독립 시장규모 추정치(밴더 리포트 등) 입력 필요", "이상치 제외 판단 필요"]));

  // ── Step 3: region/segment allocation skeleton ──
  await advance(db, analysis.id, 3);
  steps.push(
    await stepOutput(3, "권역·세그먼트 배분", analysis.name_ko, {
      regions: REGIONS,
      segments: SEGMENTS,
      cells: REGIONS.length * SEGMENTS.length,
      allocated: false,
    }, ["권역 가중치 입력 필요(인접 공시시장 프록시 기반)", "세그먼트 믹스 보정 근거 기록 필요"]));

  // ── Step 4: per-cell CAGR + scenario bands ──
  await advance(db, analysis.id, 4);
  steps.push(
    await stepOutput(4, "셀별 CAGR·시나리오 밴드", analysis.name_ko, {
      cagrBase: null,
      bandShape: { down: "base×0.5", up: "base×1.55", overridePolicy: "소스 불일치 문서화 시 wider band" },
    }, ["권역×세그먼트별 CAGR 근거 입력 필요"]));

  // ── Step 5: consistency check (pending until anchor exists) ──
  await advance(db, analysis.id, 5);
  steps.push(
    await stepOutput(5, "성장률 정합성 확인", analysis.name_ko, {
      bottomUpCagr: null,
      topDownCagr: null,
      note: "2·4단계 수동 입력 완료 후 자동 계산 예정 — 내부 정합성 확인으로만 사용(독립 검증 아님)",
    }, []));

  // ── Step 6: filing cross-validation checklist ──
  await advance(db, analysis.id, 6);
  steps.push(
    await stepOutput(6, "기업 공시 교차검증", analysis.name_ko, {
      checklist: ["카테고리 내 상위 상장사 목록", "연차·중간보고서 원문 인용", "검증 불가 항목과 구조적 공시 한계 구분"],
    }, ["상장사 공시 원문 인용 입력 필요"]));

  // ── Step 7: limitations skeleton ──
  await advance(db, analysis.id, 7);
  steps.push(
    await stepOutput(7, "분석 한계 목록", analysis.name_ko, {
      limitations: [
        "기준 시장규모 미확정(2단계 수동 입력 대기)",
        "권역·세그먼트 배분은 보정 배분으로서 바텀업 합산이 아님",
      ],
    }, []));

  // ── Step 8: registry registration status ──
  await advance(db, analysis.id, 8);
  steps.push(
    await stepOutput(8, "가정 레지스트리 등록", analysis.name_ko, {
      registered: false,
      note: "2~7단계 수동 확정 후 register-hydraulic-breaker-assumptions.ts 패턴으로 recordAssumption 등록",
    }, []));

  // ── Persist version 1 and mark completed ──
  db.transaction(() => {
    db.run(
      `INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, changelog, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [
        ulid(),
        analysis.id,
        1,
        JSON.stringify({ methodology: "systematic-market-sizing v1.1.0", steps }),
        "최초 분석 (8단계 파이프라인 스캐폴딩 — 수동 확정 항목 포함)",
        "market-sizing-pipeline",
        now(),
      ],
    );
    db.run(
      `UPDATE market_sizing_analysis SET status = 'completed', current_step = 8, completed_at = ? WHERE id = ?`,
      [now(), analysis.id],
    );
  })();
}

async function advance(db: Database, analysisId: string, step: number): Promise<void> {
  db.run("UPDATE market_sizing_analysis SET current_step = ? WHERE id = ?", [step, analysisId]);
}

async function stepOutput(
  step: number,
  title: string,
  industry: string,
  data: Record<string, unknown>,
  pendingInputs: string[],
): Promise<StepOutput> {
  // pendingInputs는 UI의 별도 목록으로 표시되므로 요약 문장에는 반복하지 않는다.
  const fallback = () =>
    `${industry} — ${title}: 방법론 절차에 따라 스캐폴딩되었습니다.` +
    (pendingInputs.length ? " 일부 입력은 아래 수동 확정 항목을 참고하세요." : " 추가 입력 없이 진행되었습니다.");
  const res = await completeOrFallback(
    [
      {
        role: "system",
        content:
          "You are a new-business market analyst. Summarize one step of a market-sizing analysis in Korean, 2 sentences max, plain text.",
      },
      { role: "user", content: `산업: ${industry}\n단계: ${title}\n데이터: ${JSON.stringify(data)}\n보완 필요: ${pendingInputs.join("; ") || "없음"}` },
    ],
    fallback,
    { maxTokens: 300 },
  );
  return { step, title, summary: res.text, source: res.source, data, pendingInputs };
}
