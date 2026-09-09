// 시장분석 인사이트 (S1 → S2 브리지) — 완료된 산업 분석의 요약(성장률,
// 외부 전망 대비 격차, 신규 드라이버)을 기회 발굴 화면에 노출한다.
// Read-only, any authenticated role. 외부 전망이 없는 분석은 gap 없이
// CAGR만 노출한다.
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();

  const rows = db
    .query(
      `SELECT a.id, a.completed_at,
              i.id AS industry_id, i.name_ko, i.ksic_code,
              v.payload, v.version_no
       FROM market_sizing_analysis a
       JOIN md_industry i ON i.id = a.industry_id
       JOIN market_sizing_version v ON v.analysis_id = a.id
       WHERE a.status = 'completed'
         AND v.version_no = (SELECT MAX(version_no) FROM market_sizing_version x WHERE x.analysis_id = a.id)
       ORDER BY a.completed_at DESC`,
    )
    .all() as Array<{ id: string; completed_at: string | null; industry_id: string; name_ko: string; ksic_code: string | null; payload: string; version_no: number }>;

  const insights = rows.map((r) => {
    type MatrixShape = {
      cagrBase?: Record<string, Record<string, number>>;
      consistency?: { bottomUpCagr?: number };
      externalForecast?: {
        sourceLabel: string; targetYear: number; marketSize: number;
        ourMarketSize?: number; gapPct?: number; gapAnalysis?: string; newDrivers?: string[];
      };
      qualitative?: { opportunityFactors?: string[]; riskFactors?: string[] };
      chainDirection?: { position?: string; note?: string; relatedIndustries?: Array<{ relation?: string; name?: string; note?: string }> };
    };
    let matrix: MatrixShape | null = null;
    try {
      matrix = (JSON.parse(r.payload) as { matrix?: MatrixShape }).matrix ?? null;
    } catch {
      matrix = null;
    }
    const ef = matrix?.externalForecast;
    const bottomUp = matrix?.consistency?.bottomUpCagr ?? null;
    return {
      analysis_id: r.id,
      industry_id: r.industry_id,
      industry_name: r.name_ko,
      ksic_code: r.ksic_code,
      completed_at: r.completed_at,
      version_no: r.version_no,
      bottom_up_cagr_pct: bottomUp,
      external_forecast: ef
        ? {
            source_label: ef.sourceLabel,
            target_year: ef.targetYear,
            external_size_b: ef.marketSize,
            our_size_b: ef.ourMarketSize ?? null,
            gap_pct: ef.gapPct ?? null,
            gap_analysis: ef.gapAnalysis ?? null,
            new_drivers: ef.newDrivers ?? [],
          }
        : null,
      opportunity_factors: matrix?.qualitative?.opportunityFactors ?? [],
      risk_factors: matrix?.qualitative?.riskFactors ?? [],
      chain_direction: matrix?.chainDirection ?? null,
    };
  });

  return ok({ insights }, 200, { count: insights.length });
}
