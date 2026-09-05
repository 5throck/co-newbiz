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
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";

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
const CRITERIA_COLS: Array<{ key: string; label: string }> = [
  { key: "control_need", label: "통제 필요도" },
  { key: "capability_criticality", label: "역량 결정성" },
  { key: "market_uncertainty", label: "시장 불확실성" },
  { key: "integration_capacity", label: "통합 역량" },
  { key: "speed_to_capability", label: "역량확보 속도" },
];

const CRITERIA_KO: Record<string, string> = {
  control_need: "통제 필요도",
  capability_criticality: "역량 결정성",
  market_uncertainty: "시장 불확실성",
  integration_capacity: "통합 역량",
  speed_to_capability: "역량확보 속도",
};

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
  const [sessions, setSessions] = useState<Array<{ sessionId: string; meta: SessionTranscript["meta"]; status: string }>>([]);
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
    api.get<{ sessions: Array<{ sessionId: string; meta: SessionTranscript["meta"]; status: string }> }>(
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
        <span className="sizing-step-badge">⚖️</span> {committeeLabel} — 위원회 심의 (ADR-0097)
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
            <span className="block mb-1">게이트</span>
            <select value={gate} onChange={(e) => setGate(e.target.value as typeof gate)} className="sizing-new-input sizing-new-input-sm">
              {gates.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void convene()}>
            {busy ? "처리 중..." : "위원회 소집"}
          </button>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              type="button"
              aria-pressed={transcript?.sessionId === s.sessionId}
              className={`sizing-industry-chip ${transcript?.sessionId === s.sessionId ? "sizing-industry-chip-active" : ""}`}
              onClick={() => loadTranscript(s.sessionId)}
            >
              <span className="font-semibold">{s.meta.decision_mode}</span>
              <span className="sizing-chip-meta">{s.meta.synthesized ? "PROPOSED" : "진행 중"} · {s.sessionId.slice(-6)}</span>
            </button>
          ))}
        </div>
      )}

      {transcript && (
        <div>
          {transcript.rounds.map((r) => (
            <div key={r.round} className="mb-3">
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
                  <pre className="whitespace-pre-wrap text-[0.78rem] m-0" style={{ fontFamily: "inherit" }}>{p.positionMd}</pre>
                </div>
              ))}
            </div>
          ))}

          {/* 좌석별 스코어카드 — position-meta 마커에서 파싱 (ADR-0104).
              5기준 점수가 없는 입장은 "—"로 표시된다 — 없는 데이터를
              있는 것처럼 보이지 않는다. */}
          {transcript.rounds.some((r) => r.positions.length > 0) && (
            <section className="mt-3 mb-3" aria-label="좌석별 스코어카드">
              <p className="text-[0.85rem] font-semibold mb-1">좌석별 스코어카드 (5기준 × 1–3점, position-meta 파싱)</p>
              <div className="table-scroll">
                <table className="data-table" aria-label="좌석별 스코어카드">
                  <caption className="sr-only">좌석별 스코어카드</caption>
                  <thead>
                    <tr>
                      <th scope="col">좌석</th>
                      <th scope="col">유형</th>
                      <th scope="col">권고</th>
                      <th scope="col">confidence</th>
                      <th scope="col">veto</th>
                      {CRITERIA_COLS.map((c) => <th scope="col" key={CRITERIA_KO[c.key] ?? c.key}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {transcript.rounds.flatMap((r) => r.positions).map((p) => {
                      const meta = parsePositionMeta(p.positionMd);
                      const rec = meta.recommendation ?? "";
                      return (
                        <tr key={p.positionId}>
                          <td className="text-[0.75rem]">{meta.seat ?? (p.memberType === "human" ? (p.humanUserId ?? "—") : (p.agentKey ?? "—"))}</td>
                          <td>
                            <span className={`status-chip ${p.memberType === "human" ? "status-green" : "status-not-started"}`}>
                              {p.memberType}
                            </span>
                          </td>
                          <td>
                            {rec ? (
                              <span className={`status-chip ${rec === "go" ? "status-green" : rec === "hold" ? "status-amber" : "status-red"}`}>
                                {REC_LABEL[rec] ?? rec}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="tabular-nums text-[0.75rem]">{meta.confidence ?? p.confidence ?? "—"}</td>
                          <td>{meta.veto_dissent ? <span className="status-chip status-red">veto</span> : "—"}</td>
                          {CRITERIA_COLS.map((c) => (
                            <td key={CRITERIA_KO[c.key] ?? c.key} className="tabular-nums text-[0.78rem]">{meta.criteria_scores?.[c.key] ?? "—"}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 회의록 — 열람(text/markdown, 새 탭) + 확정(analyst+ 인간 행위) */}
          <section className="mt-2 mb-3" aria-label="회의록">
            <p className="text-[0.85rem] font-semibold mb-1">회의록</p>
            <span className="actions-row">
              <a
                className="btn-ghost btn-sm"
                href={`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(transcript.sessionId)}/minutes`}
                target="_blank"
                rel="noreferrer"
              >
                회의록 보기
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
              <p className="text-[0.85rem] font-semibold">
                의장 종합(PROPOSED): <span className={`status-chip ${transcript.evaluation.recommendation === "go" ? "status-green" : transcript.evaluation.recommendation === "hold" ? "status-amber" : "status-red"}`}>
                  {REC_LABEL[transcript.evaluation.recommendation] ?? transcript.evaluation.recommendation}
                </span>{" "}
                <span className="text-[0.72rem] text-[color:var(--muted-fg)]">by {transcript.evaluation.evaluatedBy} · gate {transcript.evaluation.gate}</span>
              </p>
              {dissents.length > 0 && (
                <div className="mt-2">
                  <p className="text-[0.8rem] text-[color:var(--red-fg)] font-semibold">반대 의견 — 전문 그대로 (veto dissent, ADR-0096 §6)</p>
                  {dissents.map((d) => (
                    <pre key={d.member_key} className="whitespace-pre-wrap text-[0.78rem] m-0 pl-2 border-l-2" style={{ fontFamily: "inherit", borderColor: "var(--red-fg)" }}>
                      [{d.member_key}] {d.position_md}
                    </pre>
                  ))}
                </div>
              )}

              {canAct && (
                <form className="sizing-new-form mt-3" aria-label="위원회 제안 확정 (인간 기록)" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
                  <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
                    제안 확정은 인간만 수행합니다 — 게이트 결정 기록(위원회 제안이 기본값, 변경 가능)과 동일한 경로입니다.
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
    </section>
  );
}
