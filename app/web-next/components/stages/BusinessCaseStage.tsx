"use client";

// S8 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/business-case 페이지와
// /deals/[id]/s8 탭이 동일 컴포넌트를 소비한다). ProjectSubNav·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.
// 탭 상태는 독립 페이지에서 URL ?tab= 동기, embedded(deals 탭) 모드에서는 내부 상태로
// 유지한다 — router로 프로젝트 페이지를 건드리지 않는다.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProjectSubNav } from "../ProjectSubNav.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { GateDecisionPanel } from "../GateDecisionPanel.tsx";
import { TargetCheckPanel } from "../TargetCheckPanel.tsx";
import { StageFrame } from "../StageFrame.tsx";
import { TabNav } from "../TabNav.tsx";
import { WaccPanel } from "../wacc/WaccPanel.tsx";
import { ParamsPanel } from "../business-case/ParamsPanel.tsx";
import { TargetCostingPanel } from "../business-case/TargetCostingPanel.tsx";
import { FinancialAnalysisPanel } from "../FinancialAnalysisPanel.tsx";
import { useConfirm } from "../crud.tsx";

// S8 사업성 분석 — 이중 관점 밸류에이션 비교 (ADR-0117; approved mockup
// docs/designs/mockups/2026-09-11-dual-view-valuation-ui-mockup_ko.html).
// 시나리오(base/upside/downside)마다 시장 기반(진행 1차)과 과거 기반(비교
// 근거) 두 관점을 나란히 비교하고, 인간만 수행하는 채택(adopt) 액션을 둔다 —
// 경계 #2: 엔진은 권고할 뿐, 채택과 진행 기록은 사람의 행위다.

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
  variant: "market_forward" | "historical";
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

const SCENARIOS = ["base", "upside", "downside"] as const;
const SCEN_LABEL: Record<string, string> = { base: "기본(Base)", upside: "상승(Upside)", downside: "하락(Downside)" };
const VARIANT_LABEL: Record<string, string> = { market_forward: "시장 기반", historical: "과거 기반" };

function fmt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}
function pct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
/** simulation/line note의 key=value; 파싱 — 성장률·sigma 출처 표기용. */
function parseNote(note: string | null | undefined): Record<string, string> {
  if (!note) return {};
  const out: Record<string, string> = {};
  for (const part of note.split("; ")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

export function BusinessCaseStage({ projectId, embedded }: { projectId: string; embedded?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSync = !embedded;
  const [localTab, setLocalTab] = useState("scenarios");
  const tabParam = urlSync ? searchParams.get("tab") : null;
  const tab = tabParam === "overview" || tabParam === "params" || tabParam === "target-costing" || tabParam === "wacc" || tabParam === "financial-analysis" ? tabParam : "scenarios";
  const setTab = (key: string) => {
    if (urlSync) router.replace(`/projects/${projectId}/business-case?tab=${key}`, { scroll: false });
    else setLocalTab(key);
  };
  const { me } = useAuth();
  const canAct = me?.role === "admin" || me?.role === "analyst";
  const { confirm, confirmDialog } = useConfirm();
  const [data, setData] = useState<CasesResponse | null>(null);
  const [run, setRun] = useState<{ runId: string; status: string; activities: ActivityRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ modelId: string; text: string } | null>(null);
  // ADR-0118 — S8 채택 권고(제안). 채택은 사람의 행위다.
  interface AdoptionReco {
    source: "llm" | "synthesis";
    provider: string | null;
    note: string | null;
    manifest: string[];
    recommendation: {
      recommended_model_id: string | null;
      rationale_draft: string;
      what_would_change: string | null;
      key_evidence: string[];
      cautions: string[];
    };
  }
  const [reco, setReco] = useState<AdoptionReco | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);

  async function generateAdoptionReco() {
    if (recoLoading) return;
    setRecoLoading(true); setRecoError(null);
    try {
      const r = await api.post<AdoptionReco>(`/api/projects/${encodeURIComponent(projectId)}/business-case/adoption-recommendation`, {});
      setReco(r.data);
    } catch (err) {
      setRecoError(err instanceof Error ? err.message : "권고 생성 실패");
    } finally {
      setRecoLoading(false);
    }
  }

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

  function adopt(modelId: string, scenario: string | null, variant: string) {
    confirm(
      `사업 케이스 채택${scenario ? ` — ${SCEN_LABEL[scenario] ?? scenario} · ${VARIANT_LABEL[variant] ?? variant}` : ""}`,
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
      { body: "이 케이스를 FS 진행 입력으로 채택합니다. 채택은 인간 결정이며 감사 기록으로 남습니다." },
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

  // Group by scenario; within a scenario, market_forward (1차) first, newest first.
  const byScenario = useMemo(() => {
    const map = new Map<string, CaseView[]>();
    for (const s of SCENARIOS) {
      const list = (data?.cases ?? [])
        .filter((c) => c.scenario === s)
        .sort((a, b) => (a.variant === b.variant ? b.created_at.localeCompare(a.created_at) : a.variant === "market_forward" ? -1 : 1));
      map.set(s, list);
    }
    return map;
  }, [data]);

  const hasHistorical = (data?.cases ?? []).some((c) => c.variant === "historical");

  return (
<>
      <ProjectSubNav projectId={projectId} />
      <StageFrame stageId="S8" heading="S8 사업성 분석 — 이중 관점 밸류에이션 비교">
      <p className="text-[0.82rem] text-[color:var(--muted-fg)] mb-3">
        같은 시나리오를 <b>시장 기반(진행 판정 1차)</b>과 <b>과거 기반(비교 근거)</b> 두 관점으로 각각 평가해 나란히 비교합니다.
        <span className="ml-2 status-chip status-not-started">엔진 권고 ≠ 채택 — 채택은 사람의 행위입니다</span>
      </p>

      <TabNav
        className="mb-3"
        label="S8 사업성 분석 화면"
        active={tab}
        onSelect={setTab}
        tabs={[
          { key: "overview", label: "설명·생성·권고" },
          { key: "scenarios", label: "시나리오 비교" },
          { key: "params", label: "파라미터·스냅샷" },
          { key: "target-costing", label: "타겟코스팅" },
          { key: "wacc", label: "WACC" },
          { key: "financial-analysis", label: "재무분석" },
        ]}
      />

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mb-2">{error}</p>}

      {tab === "params" && <ParamsPanel projectId={projectId} />}
      {tab === "target-costing" && <TargetCostingPanel projectId={projectId} />}
      {tab === "wacc" && <WaccPanel projectId={projectId} />}
      {tab === "financial-analysis" && <FinancialAnalysisPanel projectId={projectId} />}

      {tab === "overview" && (
      <>
      {/* 두 관점의 의미 */}
      <section className="market-section sizing-step mb-3" aria-label="두 관점의 의미">
        <h3 className="sizing-step-title">두 관점의 의미</h3>
        <table className="data-table">
          <thead><tr><th scope="col">관점</th><th scope="col">성장률 근거</th><th scope="col">변동성(sigma) 근거</th><th scope="col">쓰임</th></tr></thead>
          <tbody>
            <tr>
              <td><span className="status-chip status-green">market_forward · 1차</span> 시장 기반</td>
              <td>시장 성장률 (opportunity)</td>
              <td>미래 변동성 프로파일 — 과거 매출 변동성 + WACC 자산 변동성 블렌딩</td>
              <td>S8 완료·킬 크라이테리아·RECOMMENDED 판정</td>
            </tr>
            <tr>
              <td><span className="status-chip status-amber">historical · 비교</span> 과거 기반</td>
              <td>대상 회사 매출 CAGR (DART)</td>
              <td>과거 매출 증감률 표준편차</td>
              <td>&quot;과거 실적이 지속되면&quot; 관점의 비교 근거</td>
            </tr>
          </tbody>
        </table>
        <p className="text-[0.76rem] text-[color:var(--muted-fg)] mt-1">
          <b className="text-[color:var(--warning)]">진행 판정(채택 요건·킬 크라이테리아·RECOMMENDED)은 시장 기반 값을 사용합니다.</b>{" "}
          과거 기반은 비교용이며, 둘의 차이가 클수록 성장 가정의 불확실성이 크다는 신호입니다.
        </p>
      </section>

      {canAct && (
        <div className="mb-3">
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void generate()}>
            {busy ? "생성 중..." : "이중 관점 자동 생성 (시장 기반 + 과거 기반 × 3 시나리오)"}
          </button>
        </div>
      )}

      {run && (
        <details className="mb-3" open>
          <summary className="cursor-pointer text-[0.82rem] text-[color:var(--accent)]">생성 실행 로그 ({run.runId} — {run.status})</summary>
          <ul className="sizing-note-list mt-1">
            {run.activities.map((a) => (
              <li key={a.activityId}>
                <span className={`status-chip ${a.status === "done" ? "status-green" : a.status === "failed" ? "status-red" : "status-not-started"}`}>{a.status}</span>{" "}
                <strong>{a.activityId}</strong> <span className="text-[color:var(--muted-fg)]">({a.agentKey})</span>
                {a.outputMd && <pre className="text-[0.7rem] whitespace-pre-wrap mt-1">{a.outputMd}</pre>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ── LLM 채택 권고 (결정 지원) — ADR-0118: 제안은 LLM, 채택은 사람 ── */}
      {canAct && (
        <section className="market-section sizing-step mt-3" aria-label="LLM 채택 권고">
          <h3 className="sizing-step-title text-[0.9rem]">🤖 LLM 채택 권고 (제안)</h3>
          <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-2">
            원칙 (경계 #2): 채택은 사람이 합니다 — 이 화면의 케이스들과 킬 크라이테리아 상태에서 만든 제안이며, ★ RECOMMENDED(결정론)와 별개 제안입니다.
          </p>
          {recoError && <p role="alert" className="text-[0.75rem] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
          {!reco && !recoLoading && !recoError && (
            <div className="flex flex-wrap items-center gap-2 mb-0">
              <button type="button" className="btn-ghost" onClick={() => void generateAdoptionReco()}>▶ 채택 권고 생성</button>
              <span className="text-[0.75rem] text-[color:var(--muted-fg)]">권고 케이스와 근거, "무엇이 바뀌면 뒤집히는가" 초안을 작성합니다.</span>
            </div>
          )}
          {recoLoading && <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-0">케이스 수치와 킬 크라이테리아를 근거로 초안을 작성하는 중...</p>}
          {reco && (
            <>
              <p className="mb-1 flex flex-wrap items-center gap-1">
                <span className={`status-chip ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                  {reco.source === "llm" ? `LLM 제안${reco.provider ? ` · ${reco.provider}` : ""}` : "결정론 폴백"}
                </span>
                {reco.recommendation.recommended_model_id && (
                  <span className="status-chip status-green">권고: {(data?.cases ?? []).find((c) => c.id === reco.recommendation.recommended_model_id)?.name ?? reco.recommendation.recommended_model_id}</span>
                )}
              </p>
              {reco.note && <p className="text-[0.72rem] text-[color:var(--muted-fg)] mb-1">{reco.note}</p>}
              {reco.recommendation.rationale_draft && <p className="text-[0.8rem] mb-1"><span className="font-semibold">채택 근거 초안:</span> {reco.recommendation.rationale_draft}</p>}
              {reco.recommendation.what_would_change && <p className="text-[0.8rem] mb-1"><span className="font-semibold">권고가 뒤집히는 조건:</span> {reco.recommendation.what_would_change}</p>}
              {reco.recommendation.cautions.length > 0 && (
                <p className="text-[0.72rem] text-[color:var(--amber-fg, var(--accent))] mb-1">⚠ {reco.recommendation.cautions.join(" / ")}</p>
              )}
              <p className="text-[0.7rem] text-[color:var(--muted-fg)] mb-0">이 제안이 본 산출물: {reco.manifest.join(" · ")}</p>
            </>
          )}
        </section>
      )}
      </>
      )}

      {/* 시나리오별 이중 관점 비교 */}
      {tab === "scenarios" && SCENARIOS.map((s) => {
        const cases = byScenario.get(s) ?? [];
        const newestMf = cases.find((c) => c.variant === "market_forward");
        const newestMfP50 = newestMf?.simulations.find((x) => x.percentile === "p50")?.npv_krw_m ?? null;
        return (
          <section key={s} className="market-section sizing-step mt-3" aria-label={`${SCEN_LABEL[s]} 이중 관점 비교`}>
            <h3 className="sizing-step-title">
              {SCEN_LABEL[s]}
              {newestMf?.recommended && <span className="status-chip status-green ml-1" title="정량 방법론 권고 — 최악 분위수(p05) 생존 관점 (시장 기반)">★ RECOMMENDED</span>}
              {newestMf?.adopted && <span className="status-chip status-green ml-1">채택됨 (fs 진행 입력)</span>}
            </h3>
            {cases.length === 0 ? (
              <p className="text-[0.85rem] text-[color:var(--muted-fg)]">
                이 시나리오의 케이스가 없습니다 — 자동 생성을 실행하세요.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">관점</th>
                    <th scope="col">성장률 <span className="text-[color:var(--muted-fg)]">(출처)</span></th>
                    <th scope="col">변동성 sigma <span className="text-[color:var(--muted-fg)]">(출처)</span></th>
                    <th scope="col" className="num">NPV p05</th>
                    <th scope="col" className="num">NPV p50</th>
                    <th scope="col" className="num">NPV p95</th>
                    <th scope="col" className="num">IRR</th>
                    <th scope="col" className="num">p50 차이</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => {
                    const p50 = c.simulations.find((x) => x.percentile === "p50");
                    const note = parseNote(p50?.note);
                    const irrV = p50?.irr ?? null;
                    const deltaP50 = c.variant === "historical" && newestMfP50 !== null && p50 ? p50.npv_krw_m - newestMfP50 : null;
                    const deltaPct = deltaP50 !== null && newestMfP50 ? deltaP50 / newestMfP50 : null;
                    return (
                      <tr key={c.id}>
                        <td>
                          {c.variant === "market_forward" ? <span className="status-chip status-green">1차</span> : <span className="status-chip status-amber">비교</span>}{" "}
                          <b>{VARIANT_LABEL[c.variant]}</b>
                          {c.adopted && <span className="status-chip status-green ml-1" title={`채택자 ${data?.adoption?.adoptedBy ?? ""}`}>채택됨</span>}
                        </td>
                        <td>
                          {note.growth ? `${(Number(note.growth) * 100).toFixed(1)}%` : "—"}
                          <span className="text-[color:var(--muted-fg)] text-[0.74rem]"> {note.growth_source ?? ""}</span>
                        </td>
                        <td>
                          {note.sigma ? pct1(Number(note.sigma)) : "—"}
                          <span className="text-[color:var(--muted-fg)] text-[0.74rem]"> {note.sigma_source ?? ""}</span>
                        </td>
                        {(["p05", "p50", "p95"] as const).map((p) => {
                          const sim = c.simulations.find((x) => x.percentile === p);
                          return <td key={p} className="num mono-num">{sim ? fmt(sim.npv_krw_m) : "—"}</td>;
                        })}
                        <td className="num mono-num">{irrV != null ? `${(irrV * 100).toFixed(1)}%` : "—"}</td>
                        <td className="num">
                          {deltaP50 === null ? "—" : (
                            <span className={deltaP50 >= 0 ? "text-[color:var(--success)] font-bold" : "text-[color:var(--red-fg)] font-bold"}>
                              {deltaP50 >= 0 ? "+" : ""}{fmt(deltaP50)}{deltaPct !== null ? ` (${deltaPct >= 0 ? "+" : ""}${(deltaPct * 100).toFixed(1)}%)` : ""}
                            </span>
                          )}
                        </td>
                        <td>
                          {canAct && (
                            <div className="flex flex-wrap gap-1">
                              {!c.adopted && (
                                <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => adopt(c.id, c.scenario, c.variant)}>
                                  채택
                                </button>
                              )}
                              <button type="button" className="btn-ghost btn-sm" onClick={() => startEdit(c)}>라인</button>
                              <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => remove(c.id)}>삭제</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!hasHistorical && (
                    <tr>
                      <td colSpan={9} className="text-[color:var(--muted-fg)] text-[0.8rem]">
                        과거 기반 관점 N/A — 대상 회사 연결 + DART 동기화 후 재생성하면 추가됩니다.{" "}
                        <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("financial-analysis")}>재무분석 탭에서 연결 →</button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {(cases[0]?.simulations?.[0]?.note) && (
              <p className="text-[0.7rem] text-[color:var(--muted-fg)] mt-1" title="재현 근거 (동일 시드로 재계산해도 같은 결과)">{cases[0].simulations[0].note}</p>
            )}
          </section>
        );
      })}

      {data && data.cases.length === 0 && (
        <p className="text-[0.85rem] text-[color:var(--muted-fg)]">등록된 Business Case가 없습니다 — 자동 생성을 실행하거나 수동으로 추가하세요.</p>
      )}

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

      <TargetCheckPanel projectId={projectId} />
      <div className="mt-4">
        <GateDecisionPanel opportunityId={projectId} gates={["fs"]} entityType="project" />
      </div>
      </StageFrame>
      {confirmDialog}
</>
  );
}

