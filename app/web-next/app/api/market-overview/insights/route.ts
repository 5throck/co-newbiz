// 시장분석 인사이트 (S1 → S2 브리지) — 완료된 산업 분석의 요약(성장률,
// 외부 전망 대비 격차, 신규 드라이버)을 기회 발굴 화면에 노출한다.
// Read-only, any authenticated role. 외부 전망이 없는 분석은 gap 없이
// CAGR만 노출한다.
import { getDb } from "../../../../../../db/client.ts";
import { resolveEffectiveCagr } from "../../../../lib/market-calibration.ts";
import { authenticate, requireBusinessActor } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";
import { isSyntheticSizing } from "../../../../lib/synthetic-value.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const db = getDb();

  // 산업당 최신 완료 analysis만 (가치사슬 연계 재분석이 analysis 행을 추가로
  // 만들어도 같은 산업이 중복 노출되지 않게 한다 — dedupe는 질의에서 하고,
  // 응답 shape은 그대로 유지한다).
  const rows = db
    .query(
      `SELECT a.id, a.completed_at,
              i.id AS industry_id, i.name_ko, i.ksic_code,
              v.payload, v.version_no
       FROM market_sizing_analysis a
       JOIN md_industry i ON i.id = a.industry_id
       JOIN market_sizing_version v ON v.analysis_id = a.id
       WHERE a.status = 'completed'
         AND a.id = (SELECT a2.id FROM market_sizing_analysis a2
                     WHERE a2.industry_id = a.industry_id AND a2.status = 'completed'
                     ORDER BY a2.completed_at DESC, a2.id DESC LIMIT 1)
         AND v.version_no = (SELECT MAX(version_no) FROM market_sizing_version x WHERE x.analysis_id = a.id)
       ORDER BY a.completed_at DESC`,
    )
    .all() as Array<{
    id: string;
    completed_at: string | null;
    industry_id: string;
    name_ko: string;
    ksic_code: string | null;
    payload: string;
    version_no: number;
  }>;

  const insights = rows.map((r) => {
    type MatrixShape = {
      cagrBase?: Record<string, Record<string, number>>;
      consistency?: { bottomUpCagr?: number };
      externalForecast?: {
        sourceLabel: string;
        targetYear: number;
        marketSize: number;
        ourMarketSize?: number;
        gapPct?: number;
        gapAnalysis?: string;
        newDrivers?: string[];
      };
      qualitative?: { opportunityFactors?: string[]; riskFactors?: string[] };
      chainDirection?: {
        position?: string;
        note?: string;
        relatedIndustries?: Array<{ relation?: string; name?: string; note?: string }>;
      };
      calibration?: {
        triggered?: boolean;
        ourCagrPct?: number;
        externalCagrPct?: number | null;
        gapPct?: number | null;
        previousGapPct?: number | null;
        appliedDrivers?: string[];
      };
    };
    let matrix: MatrixShape | null = null;
    let synthetic = false;
    try {
      const parsed = JSON.parse(r.payload) as { matrix?: MatrixShape; stepSummaries?: Array<{ source?: string }> };
      matrix = parsed.matrix ?? null;
      synthetic = isSyntheticSizing(parsed.stepSummaries);
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
      synthetic,
      escalated_cagr_pct: (() => {
        const eff = resolveEffectiveCagr(db, r.industry_id);
        return eff?.source === "escalated" ? eff.cagrPct : null;
      })(),
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
      calibration: matrix?.calibration
        ? {
            triggered: matrix.calibration.triggered ?? false,
            our_cagr_pct: matrix.calibration.ourCagrPct ?? null,
            external_cagr_pct: matrix.calibration.externalCagrPct ?? null,
            gap_pct: matrix.calibration.gapPct ?? null,
            previous_gap_pct: matrix.calibration.previousGapPct ?? null,
            applied_drivers: matrix.calibration.appliedDrivers ?? [],
          }
        : null,
    };
  });

  return ok({ insights }, 200, { count: insights.length });
}
