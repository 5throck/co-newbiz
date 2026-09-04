// Committee scorecard + minutes (ADR-0104). Built ON READ from the existing
// transcript (agent_position rows + gate_evaluation) — no new tables:
//   * scorecard: per-seat criteria_scores (5 criteria, 1-3) parsed from the
//     position-meta marker, aggregated to a committee table (median + spread);
//   * minutes: a deterministic Markdown meeting record (seats, positions,
//     recommendations, confidence, veto/dissent, chair synthesis, gate link);
//   * confirm: the chair's minutes sign-off is recorded in process_run
//     meta_json (minutes_confirmed_by/at) — append-only, no UPDATE of content.
import type { Database } from "bun:sqlite";
import { getCommitteeSession, parsePositionMeta, type CommitteeTranscript } from "./committee-session.ts";

export const CRITERIA = ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"] as const;
export type Criterion = (typeof CRITERIA)[number];

export interface SeatScorecardRow {
  seat: string;
  memberType: string;
  round: number;
  recommendation: string | null;
  confidence: number | null;
  veto: boolean;
  criteriaScores: Partial<Record<Criterion, number>>;
}

export interface CommitteeScorecard {
  rows: SeatScorecardRow[];
  aggregate: {
    byCriterion: Partial<Record<Criterion, { median: number; spread: number; votes: number }>>;
    recommendations: Record<string, number>;
    vetoes: number;
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

export function buildCommitteeScorecard(transcript: CommitteeTranscript): CommitteeScorecard {
  const rows: SeatScorecardRow[] = [];
  const byCriterion: Partial<Record<Criterion, number[]>> = {};
  const recommendations: Record<string, number> = {};
  let vetoes = 0;

  for (const round of transcript.rounds) {
    for (const p of round.positions) {
      const meta = parsePositionMeta(p.positionMd);
      const rec = meta.recommendation ?? null;
      if (rec) recommendations[rec] = (recommendations[rec] ?? 0) + 1;
      if (meta.veto_dissent) vetoes += 1;
      const scores: Partial<Record<Criterion, number>> = {};
      const raw = (meta as { criteria_scores?: Record<string, unknown> }).criteria_scores;
      if (raw && typeof raw === "object") {
        for (const c of CRITERIA) {
          const v = Number((raw as Record<string, unknown>)[c]);
          if (Number.isInteger(v) && v >= 1 && v <= 3) {
            scores[c] = v;
            (byCriterion[c] ??= []).push(v);
          }
        }
      }
      rows.push({
        seat: p.agentKey ?? p.humanUserId ?? `round-${round.round}`,
        memberType: p.memberType,
        round: round.round,
        recommendation: rec,
        confidence: p.confidence,
        veto: meta.veto_dissent === true,
        criteriaScores: scores,
      });
    }
  }

  const aggregate: CommitteeScorecard["aggregate"] = {
    byCriterion: {},
    recommendations,
    vetoes,
  };
  for (const c of CRITERIA) {
    const values = byCriterion[c];
    if (values?.length) {
      aggregate.byCriterion[c] = {
        median: median(values),
        spread: Math.max(...values) - Math.min(...values),
        votes: values.length,
      };
    }
  }
  return { rows, aggregate };
}

/** Deterministic Markdown meeting record — 다운로드·IC 첨부용 (ADR-0104 §minutes). */
export function buildCommitteeMinutes(db: Database, sessionId: string): string | null {
  const t = getCommitteeSession(sessionId);
  if (!t) return null;
  const scorecard = buildCommitteeScorecard(t);
  const lines: string[] = [];
  lines.push(`# 위원회 회의록 — ${t.sessionId}`);
  lines.push("");
  lines.push(`- 게이트: ${t.meta.gate ?? "—"} · 모드: ${t.meta.decision_mode ?? "—"} · 상태: ${t.status}`);
  if (t.meta.track) lines.push(`- 트랙: ${t.meta.track}`);
  if (t.committee) lines.push(`- 위원회: ${t.committee.chair ? `chair ${t.committee.chair}, ` : ""}라운드 ${t.committee.rounds}`);
  lines.push("");

  lines.push("## 좌석별 스코어카드");
  lines.push("");
  lines.push("| 좌석 | 유형 | 라운드 | 권고 | confidence | veto | " + CRITERIA.map((c) => c.split("_")[0]).join(" | ") + " |");
  lines.push("|" + Array.from({ length: 6 + CRITERIA.length }, () => "---").join("|") + "|");
  for (const r of scorecard.rows) {
    const scores = CRITERIA.map((c) => r.criteriaScores[c] ?? "—").join(" | ");
    lines.push(`| ${r.seat} | ${r.memberType} | ${r.round} | ${r.recommendation ?? "—"} | ${r.confidence ?? "—"} | ${r.veto ? "VETO" : "—"} | ${scores} |`);
  }
  lines.push("");
  lines.push("### 기준별 집계");
  lines.push("");
  for (const c of CRITERIA) {
    const agg = scorecard.aggregate.byCriterion[c];
    lines.push(`- ${c}: ${agg ? `중앙값 ${agg.median} (산포 ${agg.spread}, 표 ${agg.votes})` : "표 없음"}`);
  }
  lines.push(`- 권고 분포: ${JSON.stringify(scorecard.aggregate.recommendations)} · veto ${scorecard.aggregate.vetoes}건`);
  lines.push("");

  lines.push("## 입장 원문");
  lines.push("");
  for (const round of t.rounds) {
    lines.push(`### 라운드 ${round.round}`);
    for (const p of round.positions) {
      lines.push(`- **${p.agentKey ?? p.humanUserId ?? p.positionId}**${p.confidence !== null ? ` (confidence ${p.confidence})` : ""}: ${p.positionMd.replace(/<!--position-meta:[\s\S]*?-->/g, "").trim()}`);
    }
    lines.push("");
  }

  if (t.evaluation) {
    lines.push("## Chair 종합 판정 (gate_evaluation)");
    lines.push("");
    lines.push(`- 권고: **${t.evaluation.recommendation}** · 게이트: ${t.evaluation.gate} · 평가자: ${t.evaluation.evaluatedBy}`);
    if (t.evaluation.dissentJson) lines.push(`- 이의 기록: ${t.evaluation.dissentJson}`);
    lines.push("");
  }

  const confirmed = db
    .query("SELECT meta_json FROM process_run WHERE id = ?")
    .get(sessionId) as { meta_json: string | null } | undefined;
  const meta = confirmed?.meta_json ? (JSON.parse(confirmed.meta_json) as { minutes_confirmed_by?: string; minutes_confirmed_at?: string }) : {};
  lines.push("---");
  lines.push(`회의록 확정: ${meta.minutes_confirmed_by ? `${meta.minutes_confirmed_by} (${meta.minutes_confirmed_at})` : "미확정"}`);
  return lines.join("\n");
}

/** A3 — chair sign-off. Append-only: recorded once in process_run meta. */
export function confirmCommitteeMinutes(db: Database, sessionId: string, confirmedBy: string): void {
  const row = db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as
    | { meta_json: string | null }
    | undefined;
  if (!row) throw new Error(`committee session ${sessionId} not found`);
  const meta = row.meta_json ? (JSON.parse(row.meta_json) as Record<string, unknown>) : {};
  if (meta.minutes_confirmed_by) throw new Error("minutes already confirmed — the record is append-only");
  meta.minutes_confirmed_by = confirmedBy;
  meta.minutes_confirmed_at = new Date().toISOString();
  db.run("UPDATE process_run SET meta_json = ? WHERE id = ?", [JSON.stringify(meta), sessionId]);
}
