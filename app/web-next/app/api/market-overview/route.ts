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
      `SELECT a.id, a.industry_id, a.status, a.current_step, a.created_at, a.completed_at, a.error_message,
              (SELECT MAX(v.version_no) FROM market_sizing_version v WHERE v.analysis_id = a.id) AS latest_version
       FROM market_sizing_analysis a
       JOIN (SELECT industry_id, MAX(created_at) AS max_created FROM market_sizing_analysis GROUP BY industry_id) m
         ON m.industry_id = a.industry_id AND m.max_created = a.created_at`,
    )
    .all() as Array<{ id: string; industry_id: string; status: string; current_step: number; latest_version: number | null; created_at: string; completed_at: string | null; error_message: string | null }>;

  return ok(
    {
      industries: industries.map((i) => {
        const analysis = analyses.find((a) => a.industry_id === i.id) ?? null;
        const chainCount = sensitivities.find((s) => s.industry_id === i.id)?.driver_count ?? 0;
        // 딜 미연계 신규 산업은 chain rows 대신 분석 매트릭스의 지역×세그먼트
        // 파생 민감도 노드(6×3=18)를 연결 드라이버로 계산한다.
        const derivedCount = analysis?.status === "completed" ? 18 : 0;
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
