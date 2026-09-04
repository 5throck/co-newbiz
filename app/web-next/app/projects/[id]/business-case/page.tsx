"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { api } from "../../../../lib/api.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { GateDecisionPanel } from "../../../../components/GateDecisionPanel.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { useConfirm } from "../../../../components/crud.tsx";

// S8 사업성 분석 — 프로젝트 Business Case 비교·채택 화면 (ADR-0098 §4).
// 시나리오(base/upside/downside)별 NPV·IRR·민감도 분위수 카드 비교,
// 정량 방법론(RECOMMENDED) 배지, 그리고 인간만 수행하는 '채택(adopt)' 액션 —
// 경계 #2: 엔진은 권고할 뿐, 어떤 케이스가 fs 게이트 입력이 될지는 사람이
// 정한다. 게이트 기록은 GateDecisionPanel(gate=fs)이 담당한다.

interface SimRow {
  id: string;
  scenario: string;
  percentile: string;
  npv_krw_m: number;
  irr: number | null;
  note: string | null;
}
interface LineRow {
  id: string;
  category: string;
  name: string;
  annual_amount_krw_m: number;
  start_year: number;
  growth_rate: number;
  note: string | null;
}
interface CaseView {
  id: string;
  kind: string;
  name: string;
  horizon_years: number;
  scenario: "base" | "upside" | "downside" | null;
  source: "generated" | "manual";
  recommended: boolean;
  adopted: boolean;
  created_by: string;
  created_at: string;
  lines: LineRow[];
  simulations: SimRow[];
}
interface CasesResponse {
  cases: CaseView[];
  recommended_scenario: string | null;
  adoption: { modelId: string; adoptedBy: string; adoptedAt: string } | null;
}
interface ActivityRow {
  activityId: string;
  agentKey: string;
  status: string;
  outputMd: string | null;
}

const SCEN_LABEL: Record<string, string> = { base: "기본(Base)", upside: "상승(Upside)", downside: "하락(Downside)" };
// Scenario chips are status, NOT verdicts: upside/downside are neutral
// (status-not-started) — a downside case is not a failure.
const SCEN_CLASS: Record<string, string> = { base: "status-amber", upside: "status-not-started", downside: "status-not-started" };

function fmt(n: number): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

export default function BusinessCasePage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { me } = useAuth();
  const canAct = me?.role === "admin" || me?.role === "analyst";
  const { confirm, confirmDialog } = useConfirm();
  const [data, setData] = useState<CasesResponse | null>(null);
  const [run, setRun] = useState<{ runId: string; status: string; activities: ActivityRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Manual edit affordance: edit a case's lines as JSON (consistent with the
  // existing minimal-editor pattern) — full line replacement on save.
  const [editing, setEditing] = useState<{ modelId: string; text: string } | null>(null);

  const load = useCallback(() => {
    api.get<CasesResponse>(`/api/projects/${encodeURIComponent(projectId)}/business-case`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "사업성 분석 데이터를 불러오지 못했습니다."));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ runId: string }>(`/api/projects/${encodeURIComponent(projectId)}/business-case/generate`);
      const status = await api.get<{ runId: string; status: string; activities: ActivityRow[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/business-case/generate/${encodeURIComponent(r.data.runId)}`,
      );
      setRun({ runId: status.data.runId, status: status.data.status, activities: status.data.activities });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "자동 생성 실패");
    } finally {
      setBusy(false);
    }
  }

  function adopt(modelId: string, scenario: string | null) {
    // The adopt click is the human decision (boundary #2) — confirmed twice:
    // once in the dialog, once by the explicit 확인 in it.
    confirm(
      `사업 케이스 채택${scenario ? ` — ${SCEN_LABEL[scenario] ?? scenario}` : ""}`,
      () => {
        void (async () => {
          setBusy(true); setError(null);
          try {
            await api.post(`/api/projects/${encodeURIComponent(projectId)}/business-case/adopt`, { model_id: modelId });
            load();
          } catch (e) {
            setError(e instanceof Error ? e.message : "채택 실패");
          } finally {
            setBusy(false);
          }
        })();
      },
      { body: "이 케이스를 FS 게이트 입력으로 채택합니다. 채택은 인간 결정이며 감사 기록으로 남습니다." },
    );
  }

  function startEdit(c: CaseView) {
    setEditing({ modelId: c.id, text: JSON.stringify(c.lines.map(({ id: _id, ...l }) => l), null, 2) });
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      const lines = JSON.parse(editing.text) as Array<{ category: string; name: string; annual_amount_krw_m: number; start_year?: number; growth_rate?: number; note?: string }>;
      await api.put(`/api/projects/${encodeURIComponent(projectId)}/business-case`, { model_id: editing.modelId, lines });
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "라인 저장 실패 (JSON 형식·category 값을 확인하세요)");
    } finally {
      setBusy(false);
    }
  }

  function remove(modelId: string) {
    confirm(
      "Business Case 삭제",
      () => {
        void (async () => {
          setBusy(true);
          try {
            await api.delete(`/api/projects/${encodeURIComponent(projectId)}/business-case?model_id=${encodeURIComponent(modelId)}`);
            load();
          } catch (e) {
            setError(e instanceof Error ? e.message : "삭제 실패");
          } finally {
            setBusy(false);
          }
        })();
      },
      { body: "라인·시뮬레이션 행을 포함해 삭제합니다.", confirmLabel: "삭제" },
    );
  }

  return (
    <main className="market-page">
      <ProjectSubNav projectId={projectId} />
      <p className="text-[0.8rem] mb-2"><a className="text-[color:var(--accent)] underline" href={`/projects/${params.id}/process`}>프로세스 현황 →</a></p>
      <StageFrame stageId="S8" heading="S8 사업성 분석 — Business Case 비교">
      <p className="text-[0.82rem] text-[color:var(--muted-fg)] mb-3">
        시나리오(base/upside/downside)별 정량 평가입니다. 민감도(NPV 분위수)가 포함된 케이스가 S8 완료 요건입니다.
        <span className="ml-2 status-chip status-not-started">엔진 권고 ≠ 채택 — 채택은 사람의 행위입니다</span>
      </p>

      {canAct && (
        <div className="mb-3">
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void generate()}>
            {busy ? "생성 중..." : "3-케이스 자동 생성 (재무분석 → 밸류에이션 → 정량 방법론)"}
          </button>
        </div>
      )}

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mb-2">{error}</p>}

      {run && (
        <details className="mb-3" open>
          <summary className="cursor-pointer text-[0.82rem] text-[color:var(--accent)]">생성 실행 로그 ({run.runId} — {run.status})</summary>
          <ul className="sizing-note-list mt-1">
            {run.activities.map((a) => (
              <li key={a.activityId}>
                {/* Status, not verdict: a still-running activity is neutral, not a failure. */}
                <span className={`status-chip ${a.status === "done" ? "status-green" : a.status === "failed" ? "status-red" : "status-not-started"}`}>{a.status}</span>{" "}
                <strong>{a.activityId}</strong> <span className="text-[color:var(--muted-fg)]">({a.agentKey})</span>
                {a.outputMd && <pre className="text-[0.7rem] whitespace-pre-wrap mt-1">{a.outputMd}</pre>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="chart-pair">
        {(data?.cases ?? []).map((c) => {
          const sims = Object.fromEntries((c.simulations ?? []).map((s) => [s.percentile, s]));
          return (
            <div key={c.id} className="chart-half sizing-grade-card">
              <h3 className="text-[0.9rem] mb-1">
                {c.name}
                {" "}
                {c.scenario && <span className={`status-chip ${SCEN_CLASS[c.scenario] ?? ""}`}>{SCEN_LABEL[c.scenario] ?? c.scenario}</span>}
                {c.recommended && <span className="status-chip status-green ml-1" title="정량 방법론 권고 — 최악 분위수(p05) 생존 관점">★ RECOMMENDED</span>}
                {c.adopted && <span className="status-chip status-green ml-1" title={`채택자 ${data?.adoption?.adoptedBy ?? ""}`}>채택됨 (fs 게이트 입력)</span>}
              </h3>
              <table className="data-table" aria-label={`${c.name} 정량 평가`}>
                <caption className="sr-only">NPV/IRR 요약</caption>
                <thead>
                  <tr><th scope="col">구분</th><th scope="col">NPV (백만 KRW)</th><th scope="col">IRR</th></tr>
                </thead>
                <tbody>
                  {(["p05", "p50", "p95"] as const).map((p) => (
                    <tr key={p}>
                      <td>{p === "p05" ? "하위 5% (p05)" : p === "p50" ? "중위 (p50)" : "상위 5% (p95)"}</td>
                      <td className="mono-num">{sims[p] ? fmt(sims[p].npv_krw_m) : "—"}</td>
                      <td className="mono-num">{sims[p]?.irr != null ? `${(sims[p].irr! * 100).toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {c.simulations[0]?.note && (
                <p className="text-[0.7rem] text-[color:var(--muted-fg)] mt-1" title="재현 근거 (ADR-0052 §D.4 seeded determinism)">{c.simulations[0].note}</p>
              )}
              {c.lines.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[0.78rem] text-[color:var(--accent)]">라인 상세 ({c.lines.length}건)</summary>
                  <ul className="sizing-note-list">
                    {c.lines.map((l) => (
                      <li key={l.id}>{l.category} · {l.name}: <span className="mono-num">{fmt(l.annual_amount_krw_m)}</span> 백만 KRW (y{l.start_year}, 성장 {(l.growth_rate * 100).toFixed(1)}%)</li>
                    ))}
                  </ul>
                </details>
              )}
              {canAct && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {!c.adopted && (
                    <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => adopt(c.id, c.scenario)}>
                      fs 게이트 입력으로 채택
                    </button>
                  )}
                  <button type="button" className="btn-ghost btn-sm" onClick={() => startEdit(c)}>라인 편집</button>
                  <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => remove(c.id)}>삭제</button>
                </div>
              )}
            </div>
          );
        })}
        {data && data.cases.length === 0 && (
          <p className="text-[0.85rem] text-[color:var(--muted-fg)]">등록된 Business Case가 없습니다 — 자동 생성을 실행하거나 수동으로 추가하세요.</p>
        )}
      </div>

      {editing && (
        <section className="market-section sizing-step mt-3" aria-label="라인 편집">
          <h3 className="sizing-step-title text-[0.9rem]">라인 편집 (JSON — 저장 시 전체 교체)</h3>
          <textarea
            className="sizing-new-input w-full font-mono text-[0.75rem]"
            rows={10}
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            spellCheck={false}
          />
          <div className="flex gap-1 mt-1">
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void saveEdit()}>저장</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>취소</button>
          </div>
        </section>
      )}

      <div className="mt-4">
        <GateDecisionPanel opportunityId={projectId} gates={["fs"]} entityType="project" />
      </div>
      </StageFrame>
      {confirmDialog}
    </main>
  );
}
