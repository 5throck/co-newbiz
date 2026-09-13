"use client";

// CommitteePanel — steering-committee deliberation UI (ADR-0097 §6).
// Convene a registered committee session, watch the per-round position
// timeline (member_type badge human/agent), and read the chair's PROPOSED
// synthesis with the risk officer's dissent VERBATIM. The confirm form is
// the SAME human action GateDecisionPanel performs (POST gate-decisions with
// the proposal pre-filled, override allowed) plus the 0066
// gate_evaluation_id provenance link — in agent_team mode the panel stops at
// PROPOSED: the confirming click is always human (design boundary #2).
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { useModalFocus } from "../lib/use-modal-focus.ts";

interface SessionPosition {
  positionId: string;
  memberType: "human" | "agent";
  agentKey: string | null;
  humanUserId: string | null;
  positionMd: string;
  confidence: number | null;
  createdAt: string;
}
interface SessionTranscript {
  sessionId: string;
  status: string;
  meta: { committee_key: string; decision_mode: string; gate: string; target_ref?: string; synthesized?: boolean };
  rounds: Array<{ round: number; positions: SessionPosition[] }>;
  evaluation: { gateEvaluationId: string; gate: string; recommendation: string; dissentJson: string | null; evaluatedBy: string; createdAt: string } | null;
}
interface DissentEntry { member_key: string; position_md: string }

const REC_LABEL: Record<string, string> = { go: "GO", hold: "HOLD", kill: "KILL" };

// position-meta marker — the verbatim footnote appended to every position
// (agent and human alike). Parsed here for the per-seat scorecard table
// (ADR-0104): recommendation / veto / confidence / 5-criteria scores.
const POSITION_META_RE = /<!--position-meta:(\{[\s\S]*?\})-->/;
interface PositionMeta {
  recommendation?: string;
  veto_dissent?: boolean;
  confidence?: number;
  seat?: string;
  criteria_scores?: Record<string, number>;
}
function parsePositionMeta(positionMd: string): PositionMeta {
  const m = positionMd.match(POSITION_META_RE);
  if (!m) return {};
  try {
    return JSON.parse(m[1]) as PositionMeta;
  } catch {
    return {};
  }
}
// 좌석별 포지션 요약 (목업 18b) — recommendation/veto를 사람이 읽는
// 판정어로 압축한다. kill은 명시적 반대이므로 "이견"이 아니라 별도 라벨.
function positionLabel(meta: PositionMeta): { label: string; cls: string } {
  if (meta.veto_dissent) return { label: "이견 (veto)", cls: "status-red" };
  if (meta.recommendation === "hold") return { label: "조건부", cls: "status-amber" };
  if (meta.recommendation === "go") return { label: "수용", cls: "status-green" };
  if (meta.recommendation === "kill") return { label: "반대", cls: "status-red" };
  return { label: "—", cls: "status-not-started" };
}

// 핵심 논거 — position-meta 주석을 걷어낸 본문의 첫 줄만 요약으로 보여준다.
function coreArgument(positionMd: string, maxLen = 60): string {
  const body = stripMeta(positionMd);
  const firstLine = body.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return firstLine.length > maxLen ? `${firstLine.slice(0, maxLen)}…` : firstLine || "—";
}

// 입장 원문 표시용 — <!--position-meta:{...}-->는 저장 형식일 뿐, 검토자가
// 읽을 이유가 없는 raw JSON이다. 항상 걷어내고 본문만 보여준다.
function stripMeta(positionMd: string): string {
  return positionMd.replace(POSITION_META_RE, "").trim();
}

// 좌석 점수 집계 — 의장 종합 카드의 "근거" 문구용. 5criteria 점수가 있는
// 좌석들의 평균을 다시 평균해 하나의 요약 숫자로 낸다 (없으면 "표 없음").
function seatScoreAverage(transcript: SessionTranscript): number | null {
  const seatAverages = transcript.rounds
    .flatMap((r) => r.positions)
    .map((p) => Object.values(parsePositionMeta(p.positionMd).criteria_scores ?? {}))
    .filter((v) => v.length > 0)
    .map((v) => v.reduce((sum, n) => sum + n, 0) / v.length);
  if (!seatAverages.length) return null;
  return Math.round((seatAverages.reduce((sum, n) => sum + n, 0) / seatAverages.length) * 10) / 10;
}
function seatScoreSummary(transcript: SessionTranscript): string {
  const avg = seatScoreAverage(transcript);
  return avg !== null ? `좌석 점수 집계 ${avg}/3.0` : "좌석 점수 표 없음";
}

export function CommitteePanel({
  opportunityId,
  committeeKey,
  committeeLabel,
  gates,
  targetRef,
}: {
  opportunityId: string;
  committeeKey: string;
  committeeLabel: string;
  gates: Array<"screening" | "pre_fs" | "fs" | "dd" | "entity_ic" | "group_ic">;
  targetRef?: string;
}) {
  const { me } = useAuth();
  const canAct = me?.role === "admin" || me?.role === "analyst";
  const [sessions, setSessions] = useState<Array<{ sessionId: string; meta: SessionTranscript["meta"]; status: string; startedAt: string }>>([]);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [transcript, setTranscript] = useState<SessionTranscript | null>(null);
  const [decisionMode, setDecisionMode] = useState<"human_only" | "agent_team" | "hybrid">("agent_team");
  const [gate, setGate] = useState(gates[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The inline human-position form — an explicit form, never a prompt dialog.
  const [position, setPosition] = useState<{ text: string; recommendation: "go" | "hold" | "kill" }>({ text: "", recommendation: "go" });
  // The embedded confirm form — same shape as GateDecisionPanel's.
  const [form, setForm] = useState<{ decision: "go" | "hold" | "kill"; rationale: string; missing: string }>({ decision: "go", rationale: "", missing: "" });

  const loadSessions = useCallback(() => {
    api.get<{ sessions: Array<{ sessionId: string; meta: SessionTranscript["meta"]; status: string; startedAt: string }> }>(
      `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions`,
    ).then((r) => setSessions(r.data.sessions)).catch(() => setSessions([]));
  }, [opportunityId]);

  const loadTranscript = useCallback((sessionId: string) => {
    api.get<SessionTranscript>(`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(sessionId)}`)
      .then((r) => setTranscript(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "세션 불러오기 실패"));
  }, [opportunityId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function convene() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api.post<{ sessionId: string }>(`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions`, {
        committeeKey,
        decisionMode,
        gate,
        ...(targetRef ? { targetRef } : {}),
      });
      setNotice(`위원회 세션이 소집되었습니다 (${r.data.sessionId.slice(-6)}).`);
      loadSessions();
      loadTranscript(r.data.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "위원회 소집 실패");
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    if (!transcript || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api.post<{ status: string; round?: number }>(`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(transcript.sessionId)}/advance`, {});
      setNotice(r.data.status === "synthesized" ? "의장 종합이 완료되었습니다 — PROPOSAL을 확인하세요." : `라운드 ${r.data.round ?? ""}가 시작되었습니다.`);
      loadTranscript(transcript.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "세션 진행 실패");
    } finally {
      setBusy(false);
    }
  }

  async function submitPosition() {
    if (!transcript || busy || !position.text.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(transcript.sessionId)}/positions`, {
        positionMd: position.text,
        recommendation: position.recommendation,
      });
      setPosition({ text: "", recommendation: "go" });
      setNotice("입장이 기록되었습니다.");
      loadTranscript(transcript.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "입장 제출 실패");
    } finally {
      setBusy(false);
    }
  }

  // The human confirm — the identical click path GateDecisionPanel performs,
  // with the committee PROPOSAL pre-filled (override stays free).
  async function confirm() {
    if (!transcript?.evaluation || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/gate-decisions`, {
        gate: transcript.evaluation.gate,
        decision: form.decision,
        rationale: form.rationale.trim() || `위원회 심의(${committeeKey}) PROPOSAL ${transcript.evaluation.recommendation.toUpperCase()} 인용`,
        gate_evaluation_id: transcript.evaluation.gateEvaluationId,
        ...(form.decision === "hold" ? { missing_artifacts: form.missing.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) } : {}),
      });
      setForm({ decision: "go", rationale: "", missing: "" });
      setNotice(`결정이 기록되었습니다 (${transcript.evaluation.gate} · ${form.decision.toUpperCase()}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "결정 기록 실패");
    } finally {
      setBusy(false);
    }
  }

  // 회의록 확정 — analyst+ 인간 행위. 세션 목록이 확정 상태를 노출하지 않는
  // 경우가 있어 항상 허용하고, 이미 확정된 경우 서버 409 메시지를 그대로
  // 표면화한다 (정직성 제약 — 성공을 가장하지 않는다).
  const [minutesConfirmed, setMinutesConfirmed] = useState(false);

  async function confirmMinutes() {
    if (!transcript || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(transcript.sessionId)}/minutes`, { confirm: true });
      setMinutesConfirmed(true);
      setNotice("회의록이 확정되었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "회의록 확정 실패");
    } finally {
      setBusy(false);
    }
  }

  const dissents: DissentEntry[] = transcript?.evaluation?.dissentJson
    ? (JSON.parse(transcript.evaluation.dissentJson) as DissentEntry[])
    : [];
  const humanText = transcript && transcript.meta.decision_mode !== "agent_team" && !transcript.meta.synthesized;

  return (
    <section aria-label="위원회 심의" className="market-section sizing-step">
      <h3 className="sizing-step-title text-[0.95rem]">
        <span className="sizing-step-badge">⚖️</span> {committeeLabel} — 위원회 심의
      </h3>
      <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
        에이전트 위원회는 심의하여 <strong>제안(PROPOSED)</strong>만 남깁니다. GO·HOLD·KILL 기록은 검토자의 클릭으로만 이루어집니다 (경계 #2).
      </p>

      {canAct && (
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <label className="text-[0.78rem]">
            <span className="block mb-1">의사결정 모드</span>
            <select value={decisionMode} onChange={(e) => setDecisionMode(e.target.value as typeof decisionMode)} className="sizing-new-input sizing-new-input-sm">
              <option value="agent_team">agent_team — 위원회 심의 후 제안</option>
              <option value="hybrid">hybrid — 라운드별 인간 입장 포함</option>
              <option value="human_only">human_only — 인간 심의만</option>
            </select>
          </label>
          <label className="text-[0.78rem]">
            <span className="block mb-1">진행</span>
            <select value={gate} onChange={(e) => setGate(e.target.value as typeof gate)} className="sizing-new-input sizing-new-input-sm">
              {gates.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void convene()}>
            {busy ? "처리 중..." : "위원회 소집"}
          </button>
        </div>
      )}

      {/* 위원회 소집 이력 — 세션이 여러 건이면 어느 회차인지 구분해서 보여준다. */}
      {sessions.length > 0 && (
        <section className="mb-3" aria-label="위원회 소집 이력">
          <p className="text-[0.82rem] font-semibold mb-1">위원회 소집 이력 <span className="text-[0.72rem] font-normal text-[color:var(--muted-fg)]">{sessions.length}건</span></p>
          <div className="table-scroll">
            <table className="data-table" aria-label="위원회 소집 이력">
              <caption className="sr-only">위원회 소집 이력</caption>
              <thead>
                <tr>
                  <th scope="col">소집 일시</th>
                  <th scope="col">모드</th>
                  <th scope="col">진행</th>
                  <th scope="col">상태</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.sessionId} className={transcript?.sessionId === s.sessionId ? "row-selected" : undefined}>
                    <td className="text-[0.78rem] tabular-nums">{s.startedAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="text-[0.78rem]">{s.meta.decision_mode}</td>
                    <td className="text-[0.78rem]">{s.meta.gate}</td>
                    <td><span className={`status-chip ${s.meta.synthesized ? "status-green" : "status-in-progress"}`}>{s.meta.synthesized ? "PROPOSED" : "진행 중"}</span></td>
                    <td>
                      <button type="button" className="btn-ghost btn-sm" aria-pressed={transcript?.sessionId === s.sessionId} onClick={() => loadTranscript(s.sessionId)}>
                        {transcript?.sessionId === s.sessionId ? "보는 중" : "열기"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {transcript && (
        <div>
          {/* 좌석별 포지션 — 목업(18b 위원회 세션 뷰어) 요약 테이블: 포지션은
              recommendation/veto를 사람이 읽는 판정어(수용/조건부/이견)로,
              종합 점수는 그 좌석의 5criteria 평균으로 보여준다. 점수가 없는
              입장은 "—" — 없는 데이터를 있는 것처럼 보이지 않는다.
              여러 라운드가 있어도 최신 라운드만 요약에 보여준다 — 라운드별로
              같은 좌석이 반복 나열되면 가독성이 떨어진다. 이전 라운드 전체는
              아래 "입장 원문(라운드별)"에서 확인한다. */}
          {transcript.rounds.some((r) => r.positions.length > 0) && (
            <section className="mb-3" aria-label="좌석별 포지션">
              <p className="text-[0.85rem] font-semibold mb-1">
                좌석별 포지션 <span className="text-[0.72rem] font-normal text-[color:var(--muted-fg)]">
                  — 5기준 1–3 채점 집계{transcript.rounds.length > 1 ? ` · 라운드 ${transcript.rounds[transcript.rounds.length - 1].round} (최신)` : ""}
                </span>
              </p>
              <div className="table-scroll">
                <table className="data-table" aria-label="좌석별 포지션">
                  <caption className="sr-only">좌석별 포지션</caption>
                  <thead>
                    <tr>
                      <th scope="col">좌석 (에이전트)</th>
                      <th scope="col">포지션</th>
                      <th scope="col">핵심 논거</th>
                      <th scope="col" className="text-right">종합 점수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transcript.rounds[transcript.rounds.length - 1].positions.map((p) => {
                      const meta = parsePositionMeta(p.positionMd);
                      const seat = meta.seat ?? (p.memberType === "human" ? (p.humanUserId ?? "—") : (p.agentKey ?? "—"));
                      const posLabel = positionLabel(meta);
                      const scoreValues = Object.values(meta.criteria_scores ?? {});
                      const avgScore = scoreValues.length
                        ? Math.round((scoreValues.reduce((sum, v) => sum + v, 0) / scoreValues.length) * 10) / 10
                        : null;
                      return (
                        <tr key={p.positionId}>
                          <td className="text-[0.8rem]">{seat}</td>
                          <td><span className={`status-chip ${posLabel.cls}`}>{posLabel.label}</span></td>
                          <td className="text-[0.78rem] text-[color:var(--muted-fg)]">{coreArgument(p.positionMd)}</td>
                          <td className="tabular-nums text-right text-[0.8rem]">{avgScore ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {transcript.rounds.length > 1 && (
                <p className="text-[0.72rem] text-[color:var(--muted-fg)] mt-1 mb-0">이전 라운드는 아래 &quot;입장 원문(라운드별)&quot;에서 확인할 수 있습니다.</p>
              )}
              {canAct && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void advance()}>
                    {busy ? "처리 중..." : transcript.rounds.length === 0 ? "라운드 시작" : "의장 종합(제안) 생성"}
                  </button>
                  <span className="text-[0.72rem] text-[color:var(--muted-fg)]">다수결·동점은 HOLD · veto 이견은 원문 그대로 dissent 보존</span>
                </div>
              )}
            </section>
          )}

          {/* 의장 종합(PROPOSAL) + 소수 의견 — 목업 grid2e 두 카드 */}
          {transcript.evaluation && (
            <div className="grid gap-3 md:grid-cols-2 mb-3">
              <div className="card">
                <h4 className="text-[0.85rem] font-semibold mb-1">
                  의장 종합 (PROPOSAL){" "}
                  <span className={`status-chip ${transcript.evaluation.recommendation === "go" ? "status-green" : transcript.evaluation.recommendation === "hold" ? "status-amber" : "status-red"}`}>
                    {REC_LABEL[transcript.evaluation.recommendation] ?? transcript.evaluation.recommendation}
                  </span>
                  {dissents.length > 0 && <span className="status-chip status-red ml-1">veto 이견 반영</span>}
                </h4>
                <p className="text-[0.8rem] mb-1">
                  {committeeLabel} — {REC_LABEL[transcript.evaluation.recommendation] ?? transcript.evaluation.recommendation} 제안
                  (진행 {transcript.evaluation.gate}, {transcript.evaluation.evaluatedBy})
                </p>
                <p className="text-[0.72rem] text-[color:var(--muted-fg)] m-0">
                  근거: {seatScoreSummary(transcript)} · {dissents.length}건 이견 {dissents.length > 0 ? "반영" : "없음"} — 확정은 사람의 진행 기록
                </p>
              </div>
              <div className="card">
                <h4 className="text-[0.85rem] font-semibold mb-1">소수 의견 (dissent — 원문 보존)</h4>
                {dissents.length === 0 ? (
                  <p className="text-[0.78rem] text-[color:var(--muted-fg)] m-0">이견 없음</p>
                ) : (
                  dissents.map((d) => (
                    <pre key={d.member_key} className="whitespace-pre-wrap text-[0.78rem] m-0" style={{ fontFamily: "inherit" }}>
                      &quot;{stripMeta(d.position_md)}&quot; — {d.member_key}
                    </pre>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 입장 원문 — 라운드별 상세 (감사용 원문 보존, 저장 형식 메타는 걷어냄) */}
          <details className="mb-3">
            <summary className="text-[0.8rem] font-semibold cursor-pointer">입장 원문 (라운드별)</summary>
            {transcript.rounds.map((r) => (
              <div key={r.round} className="mt-2 mb-3">
                <p className="text-[0.8rem] font-semibold mb-1">라운드 {r.round}</p>
                {r.positions.map((p) => (
                  <div key={p.positionId} className="mb-2 pl-2 border-l-2" style={{ borderColor: "var(--muted-fg)" }}>
                    <p className="text-[0.72rem] mb-1">
                      <span className={`status-chip ${p.memberType === "human" ? "status-green" : "status-not-started"}`}>
                        {p.memberType === "human" ? "human" : "agent"}
                      </span>{" "}
                      <span className="tabular-nums">{p.memberType === "human" ? p.humanUserId : p.agentKey}</span>
                      {p.confidence !== null && <span className="text-[color:var(--muted-fg)]"> · 신뢰도 {p.confidence}</span>}
                    </p>
                    <pre className="whitespace-pre-wrap text-[0.78rem] m-0" style={{ fontFamily: "inherit" }}>{stripMeta(p.positionMd)}</pre>
                  </div>
                ))}
              </div>
            ))}
          </details>

          {/* 회의록 — 모달로 보기(포맷된 요약) + 다운로드(원문 markdown) + 확정 */}
          <section className="mt-2 mb-3" aria-label="회의록">
            <p className="text-[0.85rem] font-semibold mb-1">회의록</p>
            <span className="actions-row">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setMinutesOpen(true)}>
                회의록 보기
              </button>
              <a
                className="btn-ghost btn-sm"
                href={`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(transcript.sessionId)}/minutes`}
                target="_blank"
                rel="noreferrer"
              >
                다운로드 (.md)
              </a>
              {canAct && (
                <button type="button" className="btn-ghost btn-sm" disabled={busy || minutesConfirmed} onClick={() => void confirmMinutes()}>
                  {minutesConfirmed ? "✓ 확정됨" : "회의록 확정"}
                </button>
              )}
            </span>
          </section>

          {transcript.evaluation ? (
            <div className="mt-3 mb-2">
              {canAct && (
                <form className="sizing-new-form mt-3" aria-label="위원회 제안 확정 (인간 기록)" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
                  <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
                    제안 확정은 인간만 수행합니다 — 의사결정 기록(위원회 제안이 기본값, 변경 가능)과 동일한 경로입니다.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-[0.78rem]">
                      <span className="block mb-1">결정</span>
                      <select value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value as typeof form.decision })} className="sizing-new-input sizing-new-input-sm">
                        <option value="go">GO</option>
                        <option value="hold">HOLD</option>
                        <option value="kill">KILL</option>
                      </select>
                    </label>
                    <label className="text-[0.78rem] flex-1 min-w-[14rem]">
                      <span className="block mb-1">근거 (비우면 제안 인용)</span>
                      <input value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} className="sizing-new-input w-full" />
                    </label>
                  </div>
                  {form.decision === "hold" && (
                    <label className="block mt-2 text-[0.78rem]">
                      <span className="block mb-1">미완료 산출물 (HOLD 필수)</span>
                      <textarea value={form.missing} onChange={(e) => setForm({ ...form, missing: e.target.value })} className="sizing-new-input w-full" rows={2} />
                    </label>
                  )}
                  <button type="submit" className="btn-ghost btn-sm mt-2" disabled={busy}>결정 기록 (인간 확정)</button>
                </form>
              )}
            </div>
          ) : (
            canAct && (
              <div className="mt-2">
                {humanText && (
                  <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-2">
                    {transcript.meta.decision_mode === "hybrid" ? "hybrid: 각 라운드에 인간 입장 1건 이상이 필요합니다." : "human_only: 인간 위원 입장을 제출하세요."}
                  </p>
                )}
                {humanText && (
                  <form
                    className="sizing-new-form mb-2"
                    aria-label="인간 위원 입장 제출"
                    onSubmit={(e) => { e.preventDefault(); void submitPosition(); }}
                  >
                    <label className="block text-[0.78rem]">
                      <span className="block mb-1">입장 내용</span>
                      <textarea
                        value={position.text}
                        onChange={(e) => setPosition({ ...position, text: e.target.value })}
                        className="sizing-new-input w-full"
                        rows={3}
                        required
                      />
                    </label>
                    <div className="flex flex-wrap items-end gap-2 mt-2">
                      <label className="text-[0.78rem]">
                        <span className="block mb-1">권고</span>
                        <select
                          value={position.recommendation}
                          onChange={(e) => setPosition({ ...position, recommendation: e.target.value as typeof position.recommendation })}
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="go">GO</option>
                          <option value="hold">HOLD</option>
                          <option value="kill">KILL</option>
                        </select>
                      </label>
                      <button type="submit" className="btn-ghost btn-sm" disabled={busy || !position.text.trim()}>입장 제출</button>
                    </div>
                  </form>
                )}
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void advance()}>
                  {transcript.rounds.length === 0 ? "라운드 시작" : "다음 라운드 / 의장 종합"}
                </button>
              </div>
            )
          )}
        </div>
      )}

      {notice && <p role="status" className="text-[color:var(--green-fg)] text-[0.8rem]">{notice}</p>}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.8rem]">{error}</p>}
      {minutesOpen && transcript && (
        <MinutesModal committeeLabel={committeeLabel} transcript={transcript} dissents={dissents} onClose={() => setMinutesOpen(false)} />
      )}
    </section>
  );
}

/** 회의록 모달 — 이미 로드된 transcript를 그대로 포맷해서 보여준다(재조회·
    마크다운 파싱 없음). 다운로드용 원문 markdown은 별도 링크로 남긴다. */
function MinutesModal({
  committeeLabel,
  transcript,
  dissents,
  onClose,
}: {
  committeeLabel: string;
  transcript: SessionTranscript;
  dissents: DissentEntry[];
  onClose: () => void;
}) {
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const seats = transcript.rounds.flatMap((r) => r.positions.map((p) => ({ round: r.round, p })));
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${committeeLabel} 회의록`}
        style={{ maxWidth: "40rem", width: "100%", maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head flex items-center justify-between">
          <h2 style={{ fontSize: "0.95rem" }}>{committeeLabel} — 회의록</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="닫기">닫기</button>
        </div>
        <p className="text-[0.75rem] text-[color:var(--muted-fg)] mt-1 mb-3">
          세션 {transcript.sessionId.slice(-6)} · 진행 {transcript.meta.gate} · 모드 {transcript.meta.decision_mode} · 상태 {transcript.status}
        </p>

        <h3 className="text-[0.82rem] font-semibold mb-1">좌석별 포지션</h3>
        <div className="table-scroll mb-3">
          <table className="data-table" aria-label="좌석별 포지션">
            <caption className="sr-only">좌석별 포지션</caption>
            <thead>
              <tr>
                {transcript.rounds.length > 1 && <th scope="col">라운드</th>}
                <th scope="col">좌석</th>
                <th scope="col">포지션</th>
                <th scope="col" className="text-right">종합 점수</th>
              </tr>
            </thead>
            <tbody>
              {seats.map(({ round, p }) => {
                const meta = parsePositionMeta(p.positionMd);
                const seat = meta.seat ?? (p.memberType === "human" ? (p.humanUserId ?? "—") : (p.agentKey ?? "—"));
                const posLabel = positionLabel(meta);
                const scoreValues = Object.values(meta.criteria_scores ?? {});
                const avgScore = scoreValues.length
                  ? Math.round((scoreValues.reduce((sum, v) => sum + v, 0) / scoreValues.length) * 10) / 10
                  : null;
                return (
                  <tr key={p.positionId}>
                    {transcript.rounds.length > 1 && <td className="tabular-nums text-[0.78rem]">{round}</td>}
                    <td className="text-[0.8rem]">{seat}</td>
                    <td><span className={`status-chip ${posLabel.cls}`}>{posLabel.label}</span></td>
                    <td className="tabular-nums text-right text-[0.8rem]">{avgScore ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h3 className="text-[0.82rem] font-semibold mb-1">입장 원문</h3>
        {transcript.rounds.map((r) => (
          <div key={r.round} className="mb-3">
            {transcript.rounds.length > 1 && <p className="text-[0.78rem] font-semibold mb-1">라운드 {r.round}</p>}
            {r.positions.map((p) => {
              const meta = parsePositionMeta(p.positionMd);
              const seat = meta.seat ?? (p.memberType === "human" ? (p.humanUserId ?? "—") : (p.agentKey ?? "—"));
              return (
                <div key={p.positionId} className="mb-2 pl-2 border-l-2" style={{ borderColor: "var(--muted-fg)" }}>
                  <p className="text-[0.72rem] mb-1">
                    <span className={`status-chip ${p.memberType === "human" ? "status-green" : "status-not-started"}`}>{p.memberType}</span>{" "}
                    <span className="tabular-nums">{seat}</span>
                    {p.confidence !== null && <span className="text-[color:var(--muted-fg)]"> · 신뢰도 {p.confidence}</span>}
                  </p>
                  <p className="whitespace-pre-wrap text-[0.78rem] m-0">{stripMeta(p.positionMd)}</p>
                </div>
              );
            })}
          </div>
        ))}

        {transcript.evaluation && (
          <>
            <h3 className="text-[0.82rem] font-semibold mb-1">의장 종합 (PROPOSED)</h3>
            <p className="text-[0.8rem] mb-2">
              <span className={`status-chip ${transcript.evaluation.recommendation === "go" ? "status-green" : transcript.evaluation.recommendation === "hold" ? "status-amber" : "status-red"}`}>
                {REC_LABEL[transcript.evaluation.recommendation] ?? transcript.evaluation.recommendation}
              </span>{" "}
              <span className="text-[0.72rem] text-[color:var(--muted-fg)]">by {transcript.evaluation.evaluatedBy} · gate {transcript.evaluation.gate}</span>
            </p>
            {dissents.length > 0 && (
              <>
                <h3 className="text-[0.82rem] font-semibold text-[color:var(--red-fg)] mb-1">소수 의견 (dissent — 원문 보존)</h3>
                {dissents.map((d) => (
                  <p key={d.member_key} className="whitespace-pre-wrap text-[0.78rem] mb-2 pl-2 border-l-2" style={{ borderColor: "var(--red-fg)" }}>
                    &quot;{stripMeta(d.position_md)}&quot; — {d.member_key}
                  </p>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
