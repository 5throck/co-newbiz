// Market overview — aggregates S1 market analysis data from persisted tables:
// industries (md_industry), drivers (industry_driver), value chain links,
// proxy chains, and market observation series counts. Read-only, any
// authenticated role. This is the S1 workspace-level data (no project_id).
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();

  const industries = db
    .query("SELECT id, name_ko, name_en, ksic_code, naics_code FROM md_industry ORDER BY name_ko")
    .all() as Array<{ id: string; name_ko: string; name_en: string | null; ksic_code: string | null; naics_code: string | null }>;

  // 완료된 분석의 최신 매트릭스 셀 수(권역 × 세그먼트) — 연결 드라이버 파생 카운트용.
  // 세그먼트는 ADR-0077 이후 산업별 동적 개수이므로 상수가 아니라 payload에서 센다.
  const latestPayloads = db
    .query(
      `SELECT a.industry_id, v.payload
       FROM market_sizing_analysis a
       JOIN market_sizing_version v ON v.analysis_id = a.id
       WHERE a.status = 'completed'
         AND v.version_no = (SELECT MAX(version_no) FROM market_sizing_version WHERE analysis_id = a.id)`,
    )
    .all() as Array<{ industry_id: string; payload: string }>;
  const cellCount = new Map<string, number>();
  for (const p of latestPayloads) {
    try {
      const matrix = (JSON.parse(p.payload) as { matrix?: { baseline2026?: Record<string, Record<string, number>> } }).matrix;
      const first = matrix?.baseline2026 ? Object.values(matrix.baseline2026)[0] : undefined;
      const regions = matrix?.baseline2026 ? Object.keys(matrix.baseline2026).length : 0;
      if (regions > 0 && first) cellCount.set(p.industry_id, regions * Object.keys(first).length);
    } catch {
      // unparseable payload — leave unset, falls back to 0
    }
  }

  const drivers = db
    .query("SELECT id, code, label_ko, description FROM industry_driver ORDER BY created_at")
    .all() as Array<{ id: string; code: string; label_ko: string; description: string }>;

  const valueChainCount = db.query("SELECT COUNT(*) c FROM value_chain_link").get() as { c: number };
  const proxyChainCount = db.query("SELECT COUNT(*) c FROM proxy_link").get() as { c: number };
  const seriesCount = db.query("SELECT COUNT(DISTINCT series_id) c FROM fact_market_observation").get() as { c: number };
  const observationCount = db.query("SELECT COUNT(*) c FROM fact_market_observation").get() as { c: number };

  // Per-industry driver sensitivity counts
  const sensitivities = db
    .query(
      `SELECT cs.industry_id, mi.name_ko AS industry_name, COUNT(*) AS driver_count
       FROM chain_node_sensitivity cs
       JOIN md_industry mi ON mi.id = cs.industry_id
       GROUP BY cs.industry_id, mi.name_ko`,
    )
    .all() as Array<{ industry_id: string; industry_name: string; driver_count: number }>;

  // Per-industry latest sizing analysis — status drives the "분석 중" UI state.
  const analyses = db
    .query(
      `SELECT a.id, a.industry_id, a.status, a.current_step, a.created_at, a.completed_at, a.error_message, a.after_analysis_id, a.linked_relation, a.rerun_in_progress,
              (SELECT MAX(v.version_no) FROM market_sizing_version v WHERE v.analysis_id = a.id) AS latest_version
       FROM market_sizing_analysis a
       JOIN (SELECT industry_id, MAX(created_at) AS max_created FROM market_sizing_analysis GROUP BY industry_id) m
         ON m.industry_id = a.industry_id AND m.max_created = a.created_at`,
    )
    .all() as Array<{ id: string; industry_id: string; status: string; current_step: number; latest_version: number | null; created_at: string; completed_at: string | null; error_message: string | null; after_analysis_id: string | null; linked_relation: string | null; rerun_in_progress: number }>;

  return ok(
    {
      industries: industries.map((i) => {
        const analysis = analyses.find((a) => a.industry_id === i.id) ?? null;
        const chainCount = sensitivities.find((s) => s.industry_id === i.id)?.driver_count ?? 0;
        // 검토/안건 미연계 신규 산업은 chain rows 대신 분석 매트릭스의 권역×세그먼트
        // 셀 수(최신 버전 payload에서 실측)를 연결 드라이버로 계산한다.
        const derivedCount = analysis?.status === "completed" ? (cellCount.get(i.id) ?? 0) : 0;
        return {
          ...i,
          driver_count: Math.max(chainCount, derivedCount),
          analysis,
        };
      }),
      drivers,
      stats: {
        value_chain_links: valueChainCount.c,
        proxy_links: proxyChainCount.c,
        series_count: seriesCount.c,
        observation_count: observationCount.c,
      },
    },
    200,
    { industries: industries.length, drivers: drivers.length },
  );
}
