// Track advisory (ADR-0104) — deterministic greenfield-vs-brownfield
// recommendation from data that already exists at S4 decision time, with a
// per-signal rationale trail so the human decision (boundary #2) is grounded,
// not replaced. Also surfaces base rates from past route decisions (B2) and
// re-review triggers (B3).
import type { Database } from "bun:sqlite";
import { gapCautions, parseGapRegister, summarizeGap } from "./capability-gap.ts";
import { buildSubjectMarketContext } from "./entry-market-context.ts";

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
  baseRates: { track: string; decisions: number; with_entity_ic_go: number; killed_with_learning?: number }[];
  reReviewTriggers: string[];
}

export function computeTrackAdvisory(db: Database, opportunityId: string): TrackAdvisory {
  const signals: AdvisorySignal[] = [];

  // 1) Market signal — S1 CAGR. High growth + high uncertainty favors asset-
  // light entry (greenfield / internal venture); mature markets favor buying
  // an established position (brownfield).
  // flow.spec v2.4.0 — the same payload also feeds the competitive-structure
  // signal (1b) so a second S1 query is never needed.
  let s1HasAnalysis = false;
  let s1HasCompetitive = false;
  // ADR-0180 slice 6: resolve the S1 analysis through the opportunity's
  // industry FK (migration 0126 — the industry IS the real FK), falling back
  // to the legacy market_scope string join only when the FK is unset. The
  // name join silently missed every opportunity whose market_scope text
  // drifted from the industry name, starving the S4 advisory of its S1 input.
  const market = db
    .query(
      `SELECT i.name_ko, m.payload FROM market_sizing_analysis a
       JOIN md_industry i ON i.id = a.industry_id
       JOIN market_sizing_version m ON m.analysis_id = a.id
       WHERE a.status = 'completed' AND m.version_no = (SELECT MAX(version_no) FROM market_sizing_version x WHERE x.analysis_id = a.id)
         AND a.industry_id = (SELECT industry_id FROM opportunity WHERE id = ?)
       LIMIT 1`,
    )
    .get(opportunityId) as { name_ko: string; payload: string } | undefined
    ?? db
      .query(
        `SELECT i.name_ko, m.payload FROM market_sizing_analysis a
         JOIN md_industry i ON i.id = a.industry_id
         JOIN market_sizing_version m ON m.analysis_id = a.id
         WHERE a.status = 'completed' AND m.version_no = (SELECT MAX(version_no) FROM market_sizing_version x WHERE x.analysis_id = a.id)
           AND i.name_ko = (SELECT market_scope FROM opportunity WHERE id = ? AND industry_id IS NULL)
         LIMIT 1`,
      )
      .get(opportunityId) as { name_ko: string; payload: string } | undefined;
  if (market) {
    s1HasAnalysis = true;
    try {
      const m = (JSON.parse(market.payload) as {
        matrix?: {
          consistency?: { bottomUpCagr?: number };
          competitive?: { structure?: string; players?: Array<{ tier?: string }> };
        };
      }).matrix ?? {};
      // ADR-0181 slice 5 — the S4 growth signal reads the S2-CONFIRMED ENTRY
      // MARKET growth when set (the subject market of S3~S12), falling back
      // to the S1 whole-market CAGR. UNITS: bottomUpCagr is stored ×100
      // (percent), the entry-market growth_rate is a RATIO (0..1) — the seam
      // converts at exactly one place (percent = ratio × 100).
      const entryCtx = buildSubjectMarketContext(db, opportunityId);
      const entryGrowthPercent = entryCtx?.growthRate != null ? entryCtx.growthRate * 100 : null;
      const cagr = entryGrowthPercent ?? m.consistency?.bottomUpCagr ?? null;
      const cagrBasis = entryGrowthPercent != null ? "진입시장 성장률 (S2 확정)" : "S1 전체시장 CAGR";
      if (cagr !== null) {
        const high = cagr >= 15;
        signals.push({
          key: "market_growth", label: `시장 성장률 ${cagr.toFixed(0)}% (${cagrBasis})`,
          leans: high ? "greenfield" : "brownfield", weight: high ? 3 : 2,
          note: high
            ? "고성장 초기 시장 — 신규 진입(내부 벤처)도 수요 성장에 편승 가능"
            : "성숙 시장 — 점유율 확보가 관건이라 기존 포지션 인수·결합이 유리",
        });
      }
      // 1b) Competitive structure (v2.4.0) — concentrated markets favor
      // combining with an existing position (brownfield); fragmented markets
      // vote NOTHING so market growth alone cannot drag the recommendation
      // toward building. No competitive record → neutral info signal.
      const comp = m.competitive;
      if (comp?.structure) {
        s1HasCompetitive = true;
        const players = comp.players ?? [];
        const leaders = players.filter((p) => p.tier === "leader").length;
        const fragmented = /분산|파편화|경쟁이 치열/.test(comp.structure);
        // The recorded structure text outranks the leader-ratio heuristic: a
        // structure that says "분산" must not be read as concentrated just
        // because one of two listed players is tiered "leader" (user-manual W1-07).
        const concentrated = /독점|과점|독과점|寡占/.test(comp.structure) || (!fragmented && players.length >= 2 && leaders / players.length >= 0.5);
        if (concentrated) {
          signals.push({
            key: "competitive_structure", label: `경쟁 구조 집중 (플레이어 ${players.length}건)`,
            leans: "brownfield", weight: 2,
            note: "집중 시장 — 신규 구축보다 기존 포지션 결합이 진입의 현실적 경로",
          });
        } else if (fragmented) {
          signals.push({
            key: "competitive_structure", label: "경쟁 구조 분산",
            leans: "neutral", weight: 1,
            note: "분산 경쟁 시장 — 시장 구조만으로는 트랙을 기울이지 않는다",
          });
        } else {
          signals.push({
            key: "competitive_structure", label: "경쟁 구조 기록됨",
            leans: "neutral", weight: 1,
            note: "집중·분산 신호가 명시적이지 않음 — S1 경쟁 구조 요약을 확인하세요",
          });
        }
      }
    } catch { /* malformed matrix — skip signal */ }
  } else {
    signals.push({ key: "market_growth", label: "S1 시장분석 부재", leans: "neutral", weight: 1, note: "완료된 시장분석 없음 — 트랙 판단 근거가 약함" });
  }

  // 2) Synergy signal — opportunity synergy score (S3). The pipeline records a
  // RECOMMENDATION (ADR-0090); only a human-confirmed score (migration 0099)
  // votes on the track — an unconfirmed recommendation stays a neutral info
  // signal so an LLM draft never carries gate evidence on its own (경계 #2).
  const opp = db.query("SELECT attractiveness_score, synergy_score, synergy_score_confirmed_at, capability_gap_json FROM opportunity WHERE id = ?").get(opportunityId) as
    | { attractiveness_score: number | null; synergy_score: number | null; synergy_score_confirmed_at: string | null; capability_gap_json: string | null }
    | undefined;
  if (opp?.synergy_score !== null && opp?.synergy_score !== undefined) {
    const confirmed = opp.synergy_score_confirmed_at !== null;
    const strong = opp.synergy_score >= 60;
    signals.push({
      key: "synergy",
      label: `${confirmed ? "시너지 확정" : "시너지 권고(미확정)"} ${opp.synergy_score}`,
      leans: confirmed && strong ? "brownfield" : "neutral",
      weight: confirmed ? 2 : 1,
      note: !confirmed
        ? "사람 확정 전 권고값 — S3 시너지 화면에서 확정하면 트랙 판단 근거로 인정됩니다"
        : strong
          ? "사람이 확정한 결합 시너지가 구조화돼 있어 대상 결합 경로의 근거가 됨"
          : "확정된 결합 시너지가 약해 자체 역량 진출과 충돌하지 않음",
    });
  }

  // 3) Capability coverage signal (flow.spec v2.4.0) — S3 역량 갭 레지스터.
  // The "held" side is group/affiliate profiles only (internal standalone
  // assessment is a documented follow-up). High coverage leaves room to build
  // (greenfield); low coverage favors combining with a holder (brownfield);
  // middle coverage votes nothing. No register → neutral info signal.
  if (opp) {
    const gapReg = parseGapRegister(opp.capability_gap_json);
    if (gapReg.rows.length > 0) {
      const s = summarizeGap(gapReg.rows);
      const basis = "그룹/계열사 프로필 기준 — 내부(자사 단독) 역량 평가는 추후 보강";
      if (s.coveragePct !== null) {
        if (s.coveragePct >= 70) {
          signals.push({
            key: "capability_coverage", label: `역량 보유율 ${s.coveragePct}% (평정 ${s.evaluated}/${s.total})`,
            leans: "greenfield", weight: 2,
            note: `요구 역량 대부분을 그룹/계열사가 보유 — 자체 진출 여지 (${basis})`,
          });
        } else if (s.coveragePct <= 40) {
          signals.push({
            key: "capability_coverage", label: `역량 보유율 ${s.coveragePct}% (평정 ${s.evaluated}/${s.total})`,
            leans: "brownfield", weight: 2,
            note: `필요 역량 상당수가 미보유 — 보유자와의 결합이 유리 (${basis})`,
          });
        } else {
          signals.push({
            key: "capability_coverage", label: `역량 보유율 ${s.coveragePct}% (평정 ${s.evaluated}/${s.total})`,
            leans: "neutral", weight: 1,
            note: `중간 보유율 — 시장·경쟁·시너지 신호와 함께 판단하세요 (${basis})`,
          });
        }
      } else {
        signals.push({
          key: "capability_coverage", label: `필요 역량 수준 ${s.total}건 미판정`,
          leans: "neutral", weight: 1,
          note: "행은 있으나 보유 판정이 없습니다 — S3 시너지 화면 연계 시너지 탭에서 판정하세요",
        });
      }
      // ADR-0172 §6: caution only — a 필수 capability that is 부분 보유/미보유 is named, the vote is unchanged.
      const largeGaps = gapReg.rows.filter((r) => gapCautions(r).some((c) => c.key === "large_gap")).map((r) => r.capability);
      if (largeGaps.length > 0) {
        const last = signals[signals.length - 1];
        last.note += ` · 큰 격차 주의(필수 역량): ${largeGaps.slice(0, 3).join(", ")}${largeGaps.length > 3 ? " 외" : ""}`;
      }
    } else {
      signals.push({
        key: "capability_coverage", label: "필요 역량 수준 미작성",
        leans: "neutral", weight: 1,
        note: "필요 역량 대비 보유 역량 수준 분석이 없습니다 — S3 시너지 화면 연계 시너지 탭에서 작성하면 근거가 추가됩니다",
      });
    }
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
  const baseRateRows = db
    .query(
      `SELECT rd.track, COUNT(*) decisions,
              SUM(CASE WHEN EXISTS (
                SELECT 1 FROM gate_decision g
                WHERE g.entity_id = rd.opportunity_id AND g.gate = 'entity_ic' AND g.decision = 'go'
              ) THEN 1 ELSE 0 END) AS with_entity_ic_go
       FROM route_decision rd GROUP BY rd.track`,
    )
    .all() as Array<{ track: string; decisions: number; with_entity_ic_go: number }>;
  // ADR-0150 criterion 6 — kills with captured learning feed the S1/S2 base rates
  // (display-only corpus signal; the base-rate judgement itself stays with risk-officer).
  const killRows = db
    .query(
      `SELECT p.track, COUNT(DISTINCT p.id) AS n FROM md_project p
       WHERE EXISTS (SELECT 1 FROM venture_transition_decision v WHERE v.project_id = p.id AND v.decision = 'kill_with_learning_captured')
       GROUP BY p.track`,
    )
    .all() as Array<{ track: string | null; n: number }>;
  const baseRates = baseRateRows.map((r) => ({ ...r, killed_with_learning: killRows.find((k) => k.track === r.track)?.n ?? 0 }));

  // Re-review triggers (B3).
  const reReviewTriggers: string[] = [];
  if (s1HasAnalysis && !s1HasCompetitive) {
    reReviewTriggers.push("S1 경쟁 구조가 미기록입니다 — 경쟁 근거 없이 권고가 제한됩니다 (재분석으로 보강 권장)");
  }
  if (recommendedTrack === "greenfield") {
    const gfOk = db
      .query("SELECT COUNT(*) c FROM greenfield_assessment WHERE opportunity_id = ?")
      .get(opportunityId) as unknown as { c: number };
    if (gfOk.c === 0) reReviewTriggers.push("greenfield 권고이나 역량 평가(S5)가 없습니다 — 진출전략을 먼저 확정하세요");
  }

  return { recommendedTrack, greenfieldScore, brownfieldScore, signals, baseRates, reReviewTriggers };
}
