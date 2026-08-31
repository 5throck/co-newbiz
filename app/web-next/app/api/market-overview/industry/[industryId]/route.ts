// Industry detail — value chain, driver sensitivities, and regional data
// for one industry (S1 drill-down). Aggregates from chain_node_sensitivity,
// structure_simulation_result, and md_industry.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { industryId } = await params;
  const db = getDb();

  const industry = db
    .query("SELECT id, name_ko, name_en, ksic_code, naics_code FROM md_industry WHERE id = ?")
    .get(industryId) as
    | { id: string; name_ko: string; name_en: string | null; ksic_code: string | null; naics_code: string | null }
    | null;
  if (!industry) return notFound();

  // Driver sensitivities grouped by driver + region
  const driverSensitivities = db
    .query(
      `SELECT cs.driver_id, d.label_ko AS driver_label, cs.sensitivity, cs.lag_months,
              cs.region_code, cs.segment_code, cs.evidence_ref
       FROM chain_node_sensitivity cs
       JOIN industry_driver d ON d.id = cs.driver_id
       WHERE cs.industry_id = ?
       ORDER BY cs.driver_id, cs.region_code`,
    )
    .all(industryId) as Array<{
    driver_id: string; driver_label: string; sensitivity: number;
    lag_months: number | null; region_code: string | null; segment_code: string | null; evidence_ref: string | null;
  }>;

  // 신규 산업(딜 미연계)은 chain_node_sensitivity rows가 없다 — 완료된 분석의
  // 매트릭스에서 지역×세그먼트 수요 민감도를 파생해 같은 화면을 제공한다.
  // (민감도 = 셀 CAGR × 10, 시드 스크립트와 동일한 placeholder 척도)
  if (driverSensitivities.length === 0) {
    const latest = db
      .query(
        `SELECT v.payload FROM market_sizing_version v
         JOIN market_sizing_analysis a ON a.id = v.analysis_id
         WHERE a.industry_id = ? AND a.status = 'completed'
         ORDER BY v.version_no DESC LIMIT 1`,
      )
      .get(industryId) as { payload: string } | null;
    if (latest) {
      try {
        const matrix = (JSON.parse(latest.payload) as { matrix?: { regions?: Array<{ code: string; label: string }>; cagrBase?: Record<string, Record<string, number>> } }).matrix;
        const REGION_LABELS: Record<string, string> = {
          china: "중국", apac_ex_china: "아시아(중국 제외)", north_america: "북미",
          europe: "유럽", mea: "중동·아프리카", latam_row: "중남미/기타",
        };
        const SEG_LABELS: Record<string, string> = { construction: "건설", mining: "광산", other: "기타" };
        for (const region of matrix?.regions ?? []) {
          for (const [seg, cagr] of Object.entries(matrix?.cagrBase?.[region.code] ?? {})) {
            driverSensitivities.push({
              driver_id: `derived-${region.code}-${seg}`,
              driver_label: `수요 규모 (${REGION_LABELS[region.code] ?? region.code} · ${SEG_LABELS[seg] ?? seg})`,
              sensitivity: Math.round((cagr ?? 0) * 10 * 100) / 100,
              lag_months: 0,
              region_code: region.code,
              segment_code: seg,
              evidence_ref: "market-sizing-pipeline — 셀 CAGR 기반 파생 민감도",
            });
          }
        }
      } catch {
        // payload 파싱 실패 시 빈 배열 유지
      }
    }
  }

  // Structure simulation results (regional demand scenarios)
  const simulations = db
    .query(
      `SELECT ss.scenario, ss.region_code, ss.segment_code, ss.metric,
              ss.p05, ss.p50, ss.p95
       FROM structure_simulation_result ss
       JOIN run r ON r.id = ss.run_id
       WHERE ss.industry_id = ?
       ORDER BY ss.scenario, ss.region_code, ss.p50`,
    )
    .all(industryId) as Array<{
    scenario: string; region_code: string | null; segment_code: string | null;
    metric: string; p05: number | null; p50: number | null; p95: number | null;
  }>;

  // Regional aggregation from simulations
  const regionMap = new Map<string, { region: string; scenarios: Set<string>; p50s: number[] }>();
  for (const s of simulations) {
    if (!s.region_code) continue;
    if (!regionMap.has(s.region_code)) {
      regionMap.set(s.region_code, { region: s.region_code, scenarios: new Set(), p50s: [] });
    }
    const entry = regionMap.get(s.region_code)!;
    entry.scenarios.add(s.scenario);
    if (s.p50 !== null) entry.p50s.push(s.p50);
  }
  const regions = [...regionMap.values()].map((r) => ({
    region: r.region,
    scenario_count: r.scenarios.size,
    avg_p50: r.p50s.length > 0 ? Math.round(r.p50s.reduce((a, b) => a + b, 0) / r.p50s.length) : null,
  }));

  // Time series observations for this industry
  const series = db
    .query(
      `SELECT fmo.series_id, fmo.period_id, fmo.value, fmo.unit_id, fmo.source_id,
              fmo.revision_no, fmo.fetched_at
       FROM fact_market_observation fmo
       WHERE fmo.series_id LIKE '%' || ? || '%'
       ORDER BY fmo.series_id, fmo.period_id`,
    )
    .all(industry.name_ko ?? industryId) as Array<{
    series_id: string; period_id: string; value: number; unit_id: string;
    source_id: string; revision_no: number; fetched_at: string;
  }>;

  // Assumption-registry rows for the market-sizing report (step 8 of the
  // systematic-market-sizing procedure): hb.* rows live on the seed run.
  const sizingRun = db
    .query("SELECT id FROM run WHERE label = ? ORDER BY created_at DESC LIMIT 1")
    .get("hydraulic-breaker-matrix-seed") as { id: string } | null;
  const sizingAssumptions = sizingRun
    ? db
        .query(
          `SELECT assumption_key, kind, value, rationale, anchor_ref, as_of, ttl_days
           FROM assumption WHERE run_id = ? AND assumption_key LIKE 'hb.%' ORDER BY assumption_key`,
        )
        .all(sizingRun.id) as Array<{
        assumption_key: string; kind: string; value: number; rationale: string | null;
        anchor_ref: string | null; as_of: string; ttl_days: number | null;
      }>
    : [];

  return ok(
    {
      industry,
      driver_sensitivities: driverSensitivities,
      regions,
      simulations,
      series,
      sizing: sizingRun
        ? {
            run_id: sizingRun.id,
            run_label: "hydraulic-breaker-matrix-seed",
            assumptions: sizingAssumptions,
          }
        : null,
      versions: db
        .query(
          `SELECT v.version_no, v.changelog, v.created_by, v.created_at
           FROM market_sizing_version v
           JOIN market_sizing_analysis a ON a.id = v.analysis_id
           WHERE a.industry_id = ? ORDER BY v.version_no DESC`,
        )
        .all(industryId) as Array<{ version_no: number; changelog: string | null; created_by: string; created_at: string }>,
    },
    200,
    {
      drivers: driverSensitivities.length,
      regions: regions.length,
      simulations: simulations.length,
      series: series.length,
    },
  );
}
