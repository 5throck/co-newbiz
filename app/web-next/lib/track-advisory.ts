// Track advisory (ADR-0104) — deterministic greenfield-vs-brownfield
// recommendation from data that already exists at S4 decision time, with a
// per-signal rationale trail so the human decision (boundary #2) is grounded,
// not replaced. Also surfaces base rates from past route decisions (B2) and
// re-review triggers (B3).
import type { Database } from "bun:sqlite";

export interface AdvisorySignal {
  key: string;
  label: string;
  /** Which track this signal pushes toward. */
  leans: "greenfield" | "brownfield" | "neutral";
  weight: number; // 1 (weak) .. 3 (strong)
  note: string;
}

export interface TrackAdvisory {
  recommendedTrack: "greenfield" | "brownfield" | "neutral";
  greenfieldScore: number; // 0-100
  brownfieldScore: number; // 0-100
  signals: AdvisorySignal[];
  baseRates: { track: string; decisions: number; with_entity_ic_go: number }[];
  reReviewTriggers: string[];
}

export function computeTrackAdvisory(db: Database, opportunityId: string): TrackAdvisory {
  const signals: AdvisorySignal[] = [];

  // 1) Market signal — S1 CAGR. High growth + high uncertainty favors asset-
  // light entry (greenfield / internal venture); mature markets favor buying
  // an established position (brownfield).
  const market = db
    .query(
      `SELECT i.name_ko, m.payload FROM market_sizing_analysis a
       JOIN md_industry i ON i.id = a.industry_id
       JOIN market_sizing_version m ON m.analysis_id = a.id
       WHERE a.status = 'completed' AND m.version_no = (SELECT MAX(version_no) FROM market_sizing_version x WHERE x.analysis_id = a.id)
         AND i.name_ko = (SELECT market_scope FROM opportunity WHERE id = ?)
       LIMIT 1`,
    )
    .get(opportunityId) as { name_ko: string; payload: string } | undefined;
  if (market) {
    try {
      const cagr = ((JSON.parse(market.payload) as { matrix?: { consistency?: { bottomUpCagr?: number } } }).matrix?.consistency?.bottomUpCagr) ?? null;
      if (cagr !== null) {
        const high = cagr >= 0.15;
        signals.push({
          key: "market_growth", label: `시장 성장률 ${(cagr * 100).toFixed(0)}%`,
          leans: high ? "greenfield" : "brownfield", weight: high ? 3 : 2,
          note: high
            ? "고성장 초기 시장 — 신규 진입(내부 벤처)도 수요 성장에 편승 가능"
            : "성숙 시장 — 점유율 확보가 관건이라 기존 포지션 인수·결합이 유리",
        });
      }
    } catch { /* malformed matrix — skip signal */ }
  } else {
    signals.push({ key: "market_growth", label: "S1 시장분석 부재", leans: "neutral", weight: 1, note: "완료된 시장분석 없음 — 트랙 판단 근거가 약함" });
  }

  // 2) Brownfield signal — a screened shortlist exists (S6/S7 done).
  const shortlist = db
    .query("SELECT COUNT(*) c FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted'")
    .get(opportunityId) as unknown as { c: number };
  const koPass = db
    .query(
      `SELECT COUNT(*) c FROM brownfield_target
       WHERE opportunity_id = ? AND status = 'shortlisted' AND screening_json LIKE '%"pass"%'`,
    )
    .get(opportunityId) as unknown as { c: number };
  if (shortlist.c > 0) {
    signals.push({
      key: "shortlist", label: `브라운필드 쇼트리스트 ${shortlist.c}건`,
      leans: "brownfield", weight: 3,
      note: `S6/S7 대상 선정이 완료돼 결합 후보가 존재${koPass.c ? ` (knock-out 검토 ${koPass.c}건)` : ""}`,
    });
  } else {
    signals.push({
      key: "shortlist", label: "결합 후보 없음",
      leans: "greenfield", weight: 2,
      note: "쇼트리스트가 없으면 brownfield 실행 전제가 없다 — 자체 역량 기반 진출이 기본값",
    });
  }

  // 3) Synergy signal — opportunity synergy score (S3 recommendation).
  const opp = db.query("SELECT attractiveness_score, synergy_score FROM opportunity WHERE id = ?").get(opportunityId) as
    | { attractiveness_score: number | null; synergy_score: number | null }
    | undefined;
  if (opp?.synergy_score !== null && opp?.synergy_score !== undefined) {
    const strong = opp.synergy_score >= 60;
    signals.push({
      key: "synergy", label: `시너지 권고 ${opp.synergy_score}`,
      leans: strong ? "brownfield" : "neutral", weight: 2,
      note: strong
        ? "그룹/계열사와의 결합 시너지가 구조화돼 있어 대상 결합 경로의 근거가 됨"
        : "결합 시너지 권고가 약해 자체 역량 진출과 충돌하지 않음",
    });
  }

  // Aggregate: weighted votes → share per track.
  let gf = 0, bf = 0;
  for (const s of signals) {
    if (s.leans === "greenfield") gf += s.weight;
    else if (s.leans === "brownfield") bf += s.weight;
  }
  const total = gf + bf;
  const greenfieldScore = total ? Math.round((gf / total) * 100) : 0;
  const brownfieldScore = total ? 100 - greenfieldScore : 0;
  const recommendedTrack: TrackAdvisory["recommendedTrack"] =
    total === 0 ? "neutral" : greenfieldScore >= 60 ? "greenfield" : brownfieldScore >= 60 ? "brownfield" : "neutral";

  // Base rates (B2) — past decisions by track and whether entity_ic went.
  const baseRates = db
    .query(
      `SELECT rd.track, COUNT(*) decisions,
              SUM(CASE WHEN EXISTS (
                SELECT 1 FROM gate_decision g
                WHERE g.entity_id = rd.opportunity_id AND g.gate = 'entity_ic' AND g.decision = 'go'
              ) THEN 1 ELSE 0 END) AS with_entity_ic_go
       FROM route_decision rd GROUP BY rd.track`,
    )
    .all() as Array<{ track: string; decisions: number; with_entity_ic_go: number }>;

  // Re-review triggers (B3).
  const reReviewTriggers: string[] = [];
  if (recommendedTrack === "brownfield" && shortlist.c === 0) {
    reReviewTriggers.push("brownfield 권고이나 쇼트리스트가 비어 있습니다 — S6/S7을 먼저 완료하세요");
  }
  if (recommendedTrack === "greenfield") {
    const gfOk = db
      .query("SELECT COUNT(*) c FROM greenfield_assessment WHERE opportunity_id = ?")
      .get(opportunityId) as unknown as { c: number };
    if (gfOk.c === 0) reReviewTriggers.push("greenfield 권고이나 역량 평가(S5)가 없습니다 — 진출전략을 먼저 확정하세요");
  }

  return { recommendedTrack, greenfieldScore, brownfieldScore, signals, baseRates, reReviewTriggers };
}
