// 보정 루프 조회 — 미결 제안, 수용된 드라이버 세트, 버전 간 CAGR 격차 추이.
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import {
  acceptedCalibrationDrivers,
  latestCalibrationEscalation,
  EXCLUSION_PROPOSAL_BY,
} from "../../../../../../lib/market-calibration.ts";

export async function GET(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { industryId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) return notFound();
  // 제외 제안(amendment 2026-11-13b)은 proposed_by 마커로만 행 종류가 구별되므로
  // 서버가 is_exclusion 불리언으로 번역해 내려보낸다 — UI는 마커 문자열을 모른다.
  const proposals = (
    db
      .query(
        `SELECT c.*, v.version_no AS proposed_at_version
       FROM industry_driver_calibration c
       JOIN market_sizing_version v ON v.id = c.version_id
       WHERE c.industry_id = ? AND c.status = 'proposed'
       ORDER BY c.created_at DESC`,
      )
      .all(industryId) as Array<Record<string, unknown>>
  ).map((p) => ({ ...p, is_exclusion: p.proposed_by === EXCLUSION_PROPOSAL_BY }));
  const accepted = acceptedCalibrationDrivers(db, industryId);
  // 버전 간 격차 추이 — 각 버전 payload의 calibration 블록에서 격차를 읽는다.
  const versions = db
    .query(
      `SELECT v.id, v.version_no, v.created_at, v.payload
       FROM market_sizing_version v JOIN market_sizing_analysis a ON a.id = v.analysis_id
       WHERE a.industry_id = ? AND a.status = 'completed'
       ORDER BY v.version_no ASC`,
    )
    .all(industryId) as Array<{ id: string; version_no: number; created_at: string; payload: string }>;
  const gapTrend = versions.flatMap((v) => {
    try {
      const c = (
        JSON.parse(v.payload) as {
          matrix?: {
            calibration?: {
              gapPct?: number | null;
              ourCagrPct?: number;
              externalCagrPct?: number | null;
              triggered?: boolean;
            };
          };
        }
      ).matrix?.calibration;
      if (!c || c.gapPct == null) return [];
      return [
        {
          version_no: v.version_no,
          created_at: v.created_at,
          gap_pct: c.gapPct,
          our_cagr_pct: c.ourCagrPct ?? null,
          external_cagr_pct: c.externalCagrPct ?? null,
          triggered: c.triggered ?? false,
        },
      ];
    } catch {
      return [];
    }
  });
  return ok({ proposals, accepted, gapTrend, escalation: latestCalibrationEscalation(db, industryId) }, 200);
}
