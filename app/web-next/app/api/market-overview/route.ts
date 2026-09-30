// Market overview — aggregates S1 market analysis data from persisted tables:
// industries (md_industry), drivers (industry_driver), value chain links,
// proxy chains, and market observation series counts. Read-only, any
// authenticated role. This is the S1 workspace-level data (no project_id).
import { getDb } from "../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const db = getDb();

  const industries = db
    .query("SELECT id, name_ko, name_en, ksic_code, naics_code, pinned FROM md_industry ORDER BY name_ko")
    .all() as Array<{ id: string; name_ko: string; name_en: string | null; ksic_code: string | null; naics_code: string | null; pinned: number }>;

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
  // ADR-0131 후속 — 리포트 화면에만 있던 "합성 폴백 경고"를 목록 화면에도
  // 노출한다. LLM 미구성/장애로 일부 또는 전체 단계가 결정론 합성으로
  // 채워진 최신 완료 버전은 목록에서도 "분석 완료"로만 보이면 안 된다
  // (2026-09-13 건설·광산 중장비 제조 산업 리포트 — 부분 오염이 목록에서
  // 전혀 드러나지 않았던 사고).
  const dataQuality = new Map<string, "all_synthesis" | "partial_synthesis">();
  for (const p of latestPayloads) {
    try {
      const parsed = JSON.parse(p.payload) as {
        matrix?: { baseline2026?: Record<string, Record<string, number>> };
        stepSummaries?: Array<{ source?: string }>;
      };
      const matrix = parsed.matrix;
      const first = matrix?.baseline2026 ? Object.values(matrix.baseline2026)[0] : undefined;
      const regions = matrix?.baseline2026 ? Object.keys(matrix.baseline2026).length : 0;
      if (regions > 0 && first) cellCount.set(p.industry_id, regions * Object.keys(first).length);

      const steps = parsed.stepSummaries ?? [];
      if (steps.length > 0) {
        const allSynthesis = steps.every((s) => s.source !== "llm");
        const anySynthesis = steps.some((s) => s.source !== "llm");
        if (allSynthesis) dataQuality.set(p.industry_id, "all_synthesis");
        else if (anySynthesis) dataQuality.set(p.industry_id, "partial_synthesis");
      }
    } catch {
      // unparseable payload — leave unset, falls back to 0
    }
  }

  const drivers = db
    .query("SELECT id, code, label_ko, description FROM industry_driver ORDER BY created_at")
    .all() as Array<{ id: string; code: string; label_ko: string; description: string }>;

  // 산업 간 관계(전방/전전방/후방/후후방) — 큐(after_analysis_id/linked_relation)
  // 경유로 등록된 것만이 아니라, "가치사슬 연계" 화면에서 사람이 직접 등록한
  // proxy_link도 목록 그룹핑의 근거가 된다 (2026-09-14 사용자 리포트 — 연료전지
  // ↔ 수소 충전소 구축 서비스업을 직접 등록으로 연결했는데 목록에 반영 안 됨).
  // relation은 항상 "to_industry_id 쪽의, from_industry_id 기준 관계"로 저장되므로
  // (전방/전전방→from이 앵커, 후방/후후방→to가 앵커) 그대로 내려보내고 프런트가
  // 앵커/자식을 가른다.
  const industryLinks = db
    .query(
      `SELECT from_industry_id, to_industry_id, relation
       FROM proxy_link
       WHERE status = 'active' AND relation IS NOT NULL`,
    )
    .all() as Array<{ from_industry_id: string; to_industry_id: string; relation: string }>;

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
          analysis: analysis && analysis.status === "completed"
            ? { ...analysis, data_quality: dataQuality.get(i.id) ?? null }
            : analysis,
        };
      }),
      drivers,
      industryLinks,
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
