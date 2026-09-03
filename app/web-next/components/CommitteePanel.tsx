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
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ sessionId: string }>(`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions`, {
        committeeKey,
        decisionMode,
        gate,
        ...(targetRef ? { targetRef } : {}),
      });
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
    setBusy(true); setError(null);
    try {
      await api.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(transcript.sessionId)}/advance`, {});
      loadTranscript(transcript.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "세션 진행 실패");
    } finally {
      setBusy(false);
    }
  }

  async function submitPosition(text: string) {
    if (!transcript || busy || !text.trim()) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(transcript.sessionId)}/positions`, {
        positionMd: text,
        recommendation: form.decision,
      });
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
    setBusy(true); setError(null);
    try {
      await api.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/gate-decisions`, {
        gate: transcript.evaluation.gate,
        decision: form.decision,
        rationale: form.rationale.trim() || `위원회 심의(${committeeKey}) PROPOSAL ${transcript.evaluation.recommendation.toUpperCase()} 인용`,
        gate_evaluation_id: transcript.evaluation.gateEvaluationId,
        ...(form.decision === "hold" ? { missing_artifacts: form.missing.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) } : {}),
      });
      setForm({ decision: "go", rationale: "", missing: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "결정 기록 실패");
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
                  <button type="button" className="btn-ghost btn-sm" disabled={busy}
                    onClick={() => void submitPosition(window.prompt("입장 내용") ?? "")}>
                    인간 입장 제출
                  </button>
                )}
                <button type="button" className="btn-ghost btn-sm ml-2" disabled={busy} onClick={() => void advance()}>
                  {transcript.rounds.length === 0 ? "라운드 시작" : "다음 라운드 / 의장 종합"}
                </button>
              </div>
            )
          )}
        </div>
      )}

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.8rem]">{error}</p>}
    </section>
  );
}
