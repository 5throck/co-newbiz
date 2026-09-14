"use client";

// GateDecisionPanel — 진행 상태 표시 + 인간 의사결정 기록 (ADR-0094).
// 경계 #2: 에이전트는 진행 출력을 '권고'할 뿐, GO/HOLD/KILL 기록은 사람의 행위다.
// 이 패널은 그 기록 행위의 표준 UI이며 /route-decision·/greenfield·/brownfield에
// 마운트된다. HOLD는 missing_artifacts 없이 기록할 수 없다(soft-pass 방지).
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { GATE_LABEL, type GateMetaId } from "../lib/stage-meta.ts";

interface GateLatest {
  gate: string;
  decision: "go" | "hold" | "kill";
  rationale: string;
  missing_artifacts: string[] | null;
}
interface GateHistoryRow extends GateLatest { id: string; decided_by: string; decided_at: string }

export function GateDecisionPanel({ opportunityId, gates, killHint, entityType = "opportunity", onRecorded }: { opportunityId: string; gates: GateMetaId[]; killHint?: string | null; entityType?: "opportunity" | "project"; onRecorded?: (decision: "go" | "hold" | "kill", gate: GateMetaId) => void }) {
  const { me } = useAuth();
  const canRecord = me?.role === "admin" || me?.role === "analyst";
  const [latest, setLatest] = useState<GateLatest[] | null>(null);
  const [history, setHistory] = useState<GateHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ gate: GateMetaId; decision: "go" | "hold" | "kill"; rationale: string; missing: string }>({
    gate: gates[0],
    decision: "go",
    rationale: "",
    missing: "",
  });
  // ADR-0118 — LLM 진행 브리프(제안). 권고·근거 초안만 제공하며 결정 select는
  // 건드리지 않는다. "근거에 반영"은 rationale 프리필일 뿐, 기록은 사람이다.
  interface GateBriefData {
    source: "llm" | "synthesis";
    provider: string | null;
    note: string | null;
    manifest: string[];
    gate: string;
    brief: { recommendation: "go" | "hold" | "kill" | null; confidence: string | null; rationale_draft: string; key_evidence: string[]; cautions: string[] };
  }
  const [briefData, setBriefData] = useState<GateBriefData | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  // Project-entity carrier (S8+, ADR-0095/0098) records through the project
  // route; the default stays the S1~S7 opportunity route.
  const basePath = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(opportunityId)}/gate-decisions`;
  const briefPath = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(opportunityId)}/gate-brief`;

  const load = useCallback(() => {
    api.get<{ latest: GateLatest[]; history: GateHistoryRow[] }>(basePath)
      .then((r) => { setLatest(r.data.latest); setHistory(r.data.history); })
      .catch((e) => setError(e instanceof Error ? e.message : "진행 상태 불러오기 실패"));
  }, [basePath]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setBriefData(null); setBriefError(null); }, [opportunityId, entityType]);

  async function generateBrief() {
    if (briefLoading) return;
    setBriefLoading(true); setBriefError(null);
    try {
      const r = await api.post<GateBriefData>(briefPath, { gate: form.gate });
      setBriefData(r.data);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : "브리프 생성 실패");
    } finally {
      setBriefLoading(false);
    }
  }

  const decisionOf = (gate: string): GateLatest | undefined => latest?.find((g) => g.gate === gate);

  async function record() {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      await api.post(basePath, {
        gate: form.gate,
        decision: form.decision,
        rationale: form.rationale.trim(),
        missing_artifacts: form.decision === "hold" ? form.missing.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : undefined,
      });
      setForm((f) => ({ ...f, rationale: "", missing: "" }));
      load();
      onRecorded?.(form.decision, form.gate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "의사결정 기록 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="의사결정" className="market-section sizing-step">
      <h3 className="sizing-step-title text-[0.95rem]">
        <span className="sizing-step-badge">🚦</span> 의사결정 — 승인 기록 (경계 #2)
      </h3>
      <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
        에이전트 권고와 무관하게 GO·HOLD·KILL은 검토자가 기록합니다. HOLD는 미완료 산출물 목록 없이 기록할 수 없습니다.
      </p>
      {killHint && (
        <p className="sizing-note-list mb-2 text-[0.82rem] text-[color:var(--red-fg)]" role="note">⛔ {killHint}</p>
      )}
      {gates.length === 1 ? (
        // 진행이 하나뿐이면 표 대신 한 줄 상태로 보여준다 — 바로 아래 기록
        // 폼과 진행/결정/근거 레이블이 겹쳐 보이는 걸 피하기 위함.
        (() => {
          const g = gates[0];
          const d = decisionOf(g);
          return (
            <p className="mb-2 text-[0.82rem] flex flex-wrap items-center gap-1">
              <span className="font-semibold">{GATE_LABEL[g]} 현재 결정:</span>
              {d ? (
                <span className={`status-chip ${d.decision === "go" ? "status-green" : d.decision === "hold" ? "status-amber" : "status-red"}`}>
                  {d.decision.toUpperCase()}
                </span>
              ) : (
                <span className="status-chip status-not-started">미결정</span>
              )}
              {d?.missing_artifacts && d.missing_artifacts.length > 0 && (
                <span className="text-[0.72rem] text-[color:var(--muted-fg)]" title={d.missing_artifacts.join(", ")}>
                  미완료 {d.missing_artifacts.length}건
                </span>
              )}
              {d?.rationale && <span className="text-[0.78rem] text-[color:var(--muted-fg)]">— {d.rationale}</span>}
            </p>
          );
        })()
      ) : (
        <table className="data-table" aria-label="진행별 현재 결정">
          <caption className="sr-only">진행별 현재 결정</caption>
          <thead>
            <tr><th scope="col" className="w-[9rem]">진행</th><th scope="col" className="w-[7rem]">결정</th><th scope="col">근거</th></tr>
          </thead>
          <tbody>
            {gates.map((g) => {
              const d = decisionOf(g);
              return (
                <tr key={g}>
                  <td className="font-semibold">{GATE_LABEL[g]}</td>
                  <td>
                    {d ? (
                      <span className={`status-chip ${d.decision === "go" ? "status-green" : d.decision === "hold" ? "status-amber" : "status-red"}`}>
                        {d.decision.toUpperCase()}
                      </span>
                    ) : (
                      <span className="status-chip status-not-started">미결정</span>
                    )}
                    {d?.missing_artifacts && d.missing_artifacts.length > 0 && (
                      <span className="block text-[0.72rem] text-[color:var(--muted-fg)]" title={d.missing_artifacts.join(", ")}>
                        미완료 {d.missing_artifacts.length}건
                      </span>
                    )}
                  </td>
                  <td className="text-[0.78rem] text-[color:var(--muted-fg)]">{d?.rationale ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ADR-0118 — LLM 진행 브리프(제안): 권고·근거 초안 제공, 기록은 사람 */}
      {canRecord && (
        <div className="mt-3 border border-[color:var(--border)] rounded-lg px-3 py-2" aria-label="LLM 진행 브리프">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost btn-sm" disabled={briefLoading} onClick={() => void generateBrief()}>
              {briefLoading ? "생성 중..." : briefData ? "재생성" : "🤖 LLM 브리프 생성"}
            </button>
            <span className="text-[0.72rem] text-[color:var(--muted-fg)]">
              {form.gate} 진행 기준 — 제안은 결정 select를 바꾸지 않으며, 기록은 사람이 합니다 (경계 #2)
            </span>
          </div>
          {briefError && <p role="alert" className="text-[0.75rem] text-[color:var(--red-fg)] mt-1 mb-0">{briefError}</p>}
          {briefData && (
            <>
              {briefData.gate !== form.gate && (
                <p className="text-[0.72rem] text-[color:var(--amber-fg, var(--accent))] mt-1 mb-0">브리프는 {briefData.gate} 기준입니다 — 진행을 바꾸면 재생성하세요.</p>
              )}
              <p className="mt-2 mb-1 flex flex-wrap items-center gap-1">
                <span className={`status-chip ${briefData.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                  {briefData.source === "llm" ? `LLM 제안${briefData.provider ? ` · ${briefData.provider}` : ""}` : "결정론 폴백"}
                </span>
                {briefData.brief.recommendation && (
                  <span className={`status-chip ${briefData.brief.recommendation === "go" ? "status-green" : briefData.brief.recommendation === "hold" ? "status-amber" : "status-red"}`}>
                    권고 {briefData.brief.recommendation.toUpperCase()}
                  </span>
                )}
                {briefData.brief.confidence && <span className="text-[0.72rem] text-[color:var(--muted-fg)]">확신도 {briefData.brief.confidence}</span>}
              </p>
              {briefData.note && <p className="text-[0.72rem] text-[color:var(--muted-fg)] mb-1">{briefData.note}</p>}
              {briefData.brief.rationale_draft && <p className="text-[0.78rem] mb-1"><span className="font-semibold">근거 초안:</span> {briefData.brief.rationale_draft}</p>}
              {briefData.brief.key_evidence.length > 0 && (
                <ul className="sizing-note-list mb-1">
                  {briefData.brief.key_evidence.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
              {briefData.brief.cautions.length > 0 && (
                <p className="text-[0.72rem] text-[color:var(--amber-fg, var(--accent))] mb-1">⚠ {briefData.brief.cautions.join(" / ")}</p>
              )}
              <p className="text-[0.7rem] text-[color:var(--muted-fg)] mb-1">이 제안이 본 산출물: {briefData.manifest.join(" · ")}</p>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setForm((f) => ({ ...f, rationale: briefData.brief.rationale_draft || f.rationale }))}
                disabled={!briefData.brief.rationale_draft}
              >
                근거에 반영
              </button>
            </>
          )}
          {!briefData && !briefLoading && !briefError && (
            <p className="text-[0.72rem] text-[color:var(--muted-fg)] mt-1 mb-0">LLM이 진행 산출물을 근거로 권고와 근거 초안을 작성해 줍니다 — 기록은 사람의 몫입니다.</p>
          )}
        </div>
      )}

      {canRecord ? (
        <form
          className="sizing-new-form"
          aria-label="의사결정 기록"
          onSubmit={(e) => { e.preventDefault(); void record(); }}
        >
          <div className="flex flex-wrap items-end gap-2">
            {gates.length > 1 && (
              <label className="text-[0.78rem]">
                <span className="block mb-1">진행</span>
                <select
                  value={form.gate}
                  onChange={(e) => setForm({ ...form, gate: e.target.value as GateMetaId })}
                  className="sizing-new-input sizing-new-input-sm"
                >
                  {gates.map((g) => <option key={g} value={g}>{GATE_LABEL[g]}</option>)}
                </select>
              </label>
            )}
            <label className="text-[0.78rem]">
              <span className="block mb-1">결정</span>
              <select
                value={form.decision}
                onChange={(e) => setForm({ ...form, decision: e.target.value as "go" | "hold" | "kill" })}
                className="sizing-new-input sizing-new-input-sm"
              >
                <option value="go">GO</option>
                <option value="hold">HOLD</option>
                <option value="kill">KILL</option>
              </select>
            </label>
            <label className="text-[0.78rem] flex-1 min-w-[14rem]">
              <span className="block mb-1">근거 *</span>
              <input
                value={form.rationale}
                onChange={(e) => setForm({ ...form, rationale: e.target.value })}
                className="sizing-new-input w-full"
                required
              />
            </label>
          </div>
          {form.decision === "hold" && (
            <label className="block mt-2 text-[0.78rem]">
              <span className="block mb-1">미완료 산출물 (HOLD 필수 — 쉼표·줄바꿈 구분)</span>
              <textarea
                value={form.missing}
                onChange={(e) => setForm({ ...form, missing: e.target.value })}
                className="sizing-new-input w-full"
                rows={2}
                placeholder="예: 5-criteria 점수, 사전배제 확인"
              />
            </label>
          )}
          <button type="submit" className="btn-primary btn-sm mt-2" disabled={saving || !form.rationale.trim()}>
            {saving ? "기록 중..." : "결정"}
          </button>
        </form>
      ) : (
        <p className="text-[0.75rem] text-[color:var(--muted-fg)]">결정 기록은 analyst 역할 이상만 가능합니다.</p>
      )}

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.8rem]">{error}</p>}

      {history.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[0.8rem] text-[color:var(--accent)]">결정 이력 ({history.length}건 — append-only)</summary>
          <table className="data-table mt-2" aria-label="의사결정 이력">
            <caption className="sr-only">의사결정 이력</caption>
            <thead>
              <tr><th scope="col">진행</th><th scope="col">결정</th><th scope="col">근거</th><th scope="col">기록자</th><th scope="col">일시</th></tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{GATE_LABEL[h.gate as GateMetaId] ?? h.gate}</td>
                  <td><span className={`status-chip ${h.decision === "go" ? "status-green" : h.decision === "hold" ? "status-amber" : "status-red"}`}>{h.decision.toUpperCase()}</span></td>
                  <td className="text-[0.75rem] text-[color:var(--muted-fg)]">{h.rationale}</td>
                  <td className="text-[0.72rem]">{h.decided_by}</td>
                  <td className="text-[0.72rem] tabular-nums">{h.decided_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
