// Committee scorecard + minutes (ADR-0104). Built ON READ from the existing
// transcript (agent_position rows + gate_evaluation) — no new tables:
//   * scorecard: per-seat criteria_scores (5 criteria, 1-3) parsed from the
//     position-meta marker, aggregated to a committee table (median + spread);
//   * minutes: a deterministic Markdown meeting record (seats, positions,
//     recommendations, confidence, veto/dissent, chair synthesis, gate link);
//   * confirm: the chair's minutes sign-off is recorded in process_run
//     meta_json (minutes_confirmed_by/at) — append-only, no UPDATE of content.
import type { Database } from "bun:sqlite";
import {
  getCommitteeSession,
  isCommitteeRun,
  parsePositionMeta,
  type CommitteeTranscript,
} from "./committee-session.ts";
import type { MinutesDraft } from "./committee-chair.ts";

export const CRITERIA = [
  "control_need",
  "capability_criticality",
  "market_uncertainty",
  "integration_capacity",
  "speed_to_capability",
] as const;
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
            if (!byCriterion[c]) byCriterion[c] = [];
            byCriterion[c].push(v);
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

/** Strip the position-meta tail from a position for prose rendering. */
function stripTail(positionMd: string): string {
  return positionMd.replace(/<!--position-meta:[\s\S]*?-->/g, "").trim();
}

interface StoredMeta {
  minutes_draft?: MinutesDraft | null;
  minutes_confirmed_by?: string;
  minutes_confirmed_at?: string;
}

function storedMeta(db: Database, sessionId: string): StoredMeta {
  const row = db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as
    | { meta_json: string | null }
    | undefined;
  return row?.meta_json ? (JSON.parse(row.meta_json) as StoredMeta) : {};
}

/**
 * The structured minutes payload for ?format=json (ADR-0196 phase B): the
 * stored agenda and AI-drafted draft plus the deterministic record around
 * them. Read-only over the stored data — a GET NEVER calls the LLM
 * (ADR-0196 decision 5); the recommendation and dissent come from
 * gate_evaluation, never from the minutes draft.
 */
export function buildCommitteeMinutesJson(db: Database, sessionId: string) {
  const t = getCommitteeSession(sessionId);
  if (!t) return null;
  const meta = storedMeta(db, sessionId);
  return {
    sessionId: t.sessionId,
    status: t.status,
    committeeKey: t.meta.committee_key ?? null,
    gate: t.meta.gate ?? null,
    decisionMode: t.meta.decision_mode ?? null,
    track: t.meta.track ?? null,
    agenda: t.agenda,
    agendaMeta: t.agendaMeta,
    minutesDraft: t.minutesDraft,
    minutesConfirmed: meta.minutes_confirmed_by
      ? { by: meta.minutes_confirmed_by, at: meta.minutes_confirmed_at ?? "" }
      : null,
    recommendation: t.evaluation?.recommendation ?? null,
    dissentJson: t.evaluation?.dissentJson ?? null,
    scorecard: buildCommitteeScorecard(t),
  };
}

/**
 * Rendered minutes, ADR-0196 §2.4 section order: header + disclaimer,
 * attendees, agenda, discussion by issue, agreements, preserved dissent
 * (VERBATIM from dissent_json — never summarized), stance changes, open
 * questions / action items, proposed recommendation (labelled a proposal,
 * never a decision), appendix (scorecard + full verbatim positions with
 * pos-<id> anchors), footer with the AI-drafted label and confirm line.
 * Pre-structured sessions render with an explicit "not available" note and
 * keep the full appendix (design §5 — no backfill).
 */
export function buildCommitteeMinutes(db: Database, sessionId: string): string | null {
  const t = getCommitteeSession(sessionId);
  if (!t) return null;
  const scorecard = buildCommitteeScorecard(t);
  const meta = storedMeta(db, sessionId);
  const draft = t.minutesDraft;
  const lines: string[] = [];

  // 1. Header + disclaimer.
  lines.push(`# 위원회 회의록 — ${t.sessionId}`);
  lines.push("");
  lines.push(`- 진행: ${t.meta.gate ?? "—"} · 모드: ${t.meta.decision_mode ?? "—"} · 상태: ${t.status}`);
  if (t.meta.track) lines.push(`- 트랙: ${t.meta.track}`);
  if (t.committee)
    lines.push(`- 위원회: ${t.committee.chair ? `chair ${t.committee.chair}, ` : ""}라운드 ${t.committee.rounds}`);
  lines.push("");
  lines.push("> Decision support. The gate decision is recorded only by a human in gate_decision.");
  lines.push("");

  // 2. Attendees and seats.
  const seats = new Map<string, { memberType: string; chair: boolean }>();
  for (const round of t.rounds) {
    for (const p of round.positions) {
      const seat = p.agentKey ?? p.humanUserId ?? `round-${round.round}`;
      if (!seats.has(seat)) seats.set(seat, { memberType: p.memberType, chair: t.committee?.chair === seat });
    }
  }
  lines.push("## 참석 좌석");
  lines.push("");
  for (const [seat, info] of seats) {
    const tags = [info.memberType, info.chair ? "의장(기록자)" : null].filter(Boolean).join(", ");
    lines.push(`- ${seat} (${tags})`);
  }
  lines.push("");

  // 3. Agenda (chair proposal).
  lines.push("## 안건 쟁점 (의장 제안)");
  lines.push("");
  if (t.agenda && t.agenda.length > 0) {
    for (const issue of t.agenda) {
      const tags = [
        issue.contested ? "쟁점 분분" : null,
        issue.raisedBy?.length ? `제기: ${issue.raisedBy.join(", ")}` : null,
      ].filter(Boolean);
      lines.push(`- ${issue.id}: ${issue.title}${tags.length ? ` (${tags.join("; ")})` : ""}`);
    }
  } else {
    lines.push("- (안건 쟁점 없음 — 라운드 1 단축 심의 또는 구조화 이전 세션)");
  }
  if (t.agendaMeta) lines.push(`- 생성: ${t.agendaMeta.source}${t.agendaMeta.model ? ` (${t.agendaMeta.model})` : ""}`);
  lines.push("");

  // 4. Discussion by issue (AI-drafted, ref-checked at generation time).
  lines.push("## 쟁점별 논의");
  lines.push("");
  if (draft) {
    for (const d of draft.json.discussion) {
      const title = t.agenda?.find((a) => a.id === d.issue_id)?.title ?? d.issue_id;
      lines.push(`### ${d.issue_id}: ${title}`);
      lines.push("");
      if (d.exchanges.length === 0) lines.push("- (교환 기록 없음)");
      for (const e of d.exchanges) {
        lines.push(`- **${e.seat}** (${e.act}): ${e.summary} → #pos-${e.position_ref}`);
      }
      lines.push(`- 결론: **${d.resolution}**${d.resolution_note ? ` — ${d.resolution_note}` : ""}`);
      lines.push("");
    }
  } else {
    lines.push("- 사용 불가 (사전 구조화 회의록 이전 세션 — session predates structured minutes). 전문은 부록 참조.");
    lines.push("");
  }

  // 5. Points of agreement.
  lines.push("## 합의 사항");
  lines.push("");
  if (draft && draft.json.agreements.length > 0) {
    for (const a of draft.json.agreements) lines.push(`- ${a.text} (${a.seats.join(", ")})`);
  } else {
    lines.push("- 기록 없음");
  }
  lines.push("");

  // 6. Preserved dissent — VERBATIM from dissent_json (ADR-0096 §6).
  lines.push("## 보존된 이의 (dissent)");
  lines.push("");
  if (t.evaluation?.dissentJson) {
    try {
      const dissents = JSON.parse(t.evaluation.dissentJson) as Array<{ member_key: string; position_md: string }>;
      for (const d of dissents) lines.push(`### ${d.member_key}`, "", d.position_md, "");
    } catch {
      lines.push(`- ${t.evaluation.dissentJson}`);
    }
  } else {
    lines.push("- 이의 기록 없음");
  }

  // 7. Stance changes across rounds (deterministic, from the tails).
  lines.push("## 라운드 간 입장 변화");
  lines.push("");
  const changed: string[] = [];
  for (const round of t.rounds) {
    for (const p of round.positions) {
      const m = parsePositionMeta(p.positionMd) as { stance_changed?: boolean };
      if (m.stance_changed) changed.push(`- ${p.agentKey ?? p.humanUserId} (라운드 ${round.round}): changed`);
    }
  }
  lines.push(...(changed.length > 0 ? changed : ["- 기록된 입장 변화 없음"]));
  lines.push("");

  // 8. Open questions and action items.
  lines.push("## 미해결 질문 및 실행 항목");
  lines.push("");
  if (draft && (draft.json.open_questions.length > 0 || draft.json.action_items.length > 0)) {
    for (const q of draft.json.open_questions) {
      lines.push(
        `- 질문: ${q.text}${q.owner_seat ? ` (담당 seat: ${q.owner_seat})` : q.owner_role ? ` (담당 역할: ${q.owner_role})` : ""}${q.due_hint ? ` [기한 힌트: ${q.due_hint}]` : ""}`,
      );
    }
    for (const a of draft.json.action_items) {
      lines.push(
        `- 실행: ${a.text}${a.owner_seat ? ` (담당 seat: ${a.owner_seat})` : a.owner_role ? ` (담당 역할: ${a.owner_role})` : ""}`,
      );
    }
  } else {
    lines.push("- 기록 없음");
  }
  lines.push("");

  // 9. Proposed recommendation — from gate_evaluation, labelled a proposal.
  if (t.evaluation) {
    lines.push("## 제안 권고 (proposal, not a decision)");
    lines.push("");
    lines.push(
      `- 권고: **${t.evaluation.recommendation}** · 진행: ${t.evaluation.gate} · 평가자: ${t.evaluation.evaluatedBy}`,
    );
    lines.push(
      `- 권고 분포: ${JSON.stringify(scorecard.aggregate.recommendations)} · veto ${scorecard.aggregate.vetoes}건`,
    );
    lines.push("");
  }

  // 10. Appendix: seat scorecard + full verbatim positions with anchors.
  lines.push("## 부록 A — 좌석별 스코어카드");
  lines.push("");
  lines.push(
    `| 좌석 | 유형 | 라운드 | 권고 | confidence | veto | ${CRITERIA.map((c) => c.split("_")[0]).join(" | ")} |`,
  );
  lines.push(`|${Array.from({ length: 6 + CRITERIA.length }, () => "---").join("|")}|`);
  for (const r of scorecard.rows) {
    const scores = CRITERIA.map((c) => r.criteriaScores[c] ?? "—").join(" | ");
    lines.push(
      `| ${r.seat} | ${r.memberType} | ${r.round} | ${r.recommendation ?? "—"} | ${r.confidence ?? "—"} | ${r.veto ? "VETO" : "—"} | ${scores} |`,
    );
  }
  lines.push("");
  for (const c of CRITERIA) {
    const agg = scorecard.aggregate.byCriterion[c];
    lines.push(`- ${c}: ${agg ? `중앙값 ${agg.median} (산포 ${agg.spread}, 표 ${agg.votes})` : "표 없음"}`);
  }
  lines.push("");
  lines.push("## 부록 B — 입장 원문 (전문)");
  lines.push("");
  for (const round of t.rounds) {
    lines.push(`### 라운드 ${round.round}`);
    lines.push("");
    for (const p of round.positions) {
      lines.push(`<a id="pos-${p.positionId}"></a>`);
      lines.push(
        `#### ${p.agentKey ?? p.humanUserId ?? p.positionId}${p.confidence !== null ? ` (confidence ${p.confidence})` : ""}`,
      );
      lines.push("");
      lines.push(stripTail(p.positionMd));
      lines.push("");
    }
  }

  // 11. Footer: AI-drafted label + confirmation line.
  lines.push("---");
  if (draft) {
    lines.push(
      `AI-drafted (chair minutes pass${draft.model ? `, ${draft.model}` : ""}${draft.fallback ? ", fallback" : ""}), verify against appendix.`,
    );
  }
  lines.push(
    `회의록 확정: ${meta.minutes_confirmed_by ? `${meta.minutes_confirmed_by} (${meta.minutes_confirmed_at})` : "미확정"}`,
  );
  return lines.join("\n");
}

/** A3 — chair sign-off. Append-only: recorded once in process_run meta. */
export function confirmCommitteeMinutes(db: Database, sessionId: string, confirmedBy: string): void {
  const row = db.query("SELECT meta_json, stage FROM process_run WHERE id = ?").get(sessionId) as
    | { meta_json: string | null; stage: string }
    | undefined;
  // Only a committee-stage run is a session (never e.g. s11_execution_baseline).
  if (!row || !isCommitteeRun(row.stage, row.meta_json)) throw new Error(`committee session ${sessionId} not found`);
  const meta = row.meta_json ? (JSON.parse(row.meta_json) as Record<string, unknown>) : {};
  if (meta.minutes_confirmed_by) throw new Error("minutes already confirmed — the record is append-only");
  meta.minutes_confirmed_by = confirmedBy;
  meta.minutes_confirmed_at = new Date().toISOString();
  db.run("UPDATE process_run SET meta_json = ? WHERE id = ?", [JSON.stringify(meta), sessionId]);
}
