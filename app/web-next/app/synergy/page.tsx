"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { useConfirm } from "../../components/crud.tsx";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { GateDecisionPanel } from "../../components/GateDecisionPanel.tsx";
import { ListBackButton } from "../../components/ListBackButton.tsx";
import dynamic from "next/dynamic";
import { useChartTheme } from "../../lib/echarts-theme.ts";

const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

// S3 시너지 정합성 (/synergy) — S1 시장분석 + S2 기회발굴 결과를 회사 단위로
// 분석해 시너지 영역 후보 → 우선 시너지 영역으로 좁히는 단계.
// (용어 규약: Long/Short List는 S6/S7 대상 후보 회사 전용 — ui-spec 2026-09-05)
// ① 분석 대상 회사 테이블(등록·재분석) → ② 회사 선택 시 탭 구조 리포트.
// 재분석 시 같은 분석 행을 재사용하고 새 버전(append-only)을 쌓는다.

interface SynergyStepSummary { step: number; title: string; summary: string; source: string }
interface SynergySourceRef { title: string; url: string; snippet?: string }
interface SynergyPayload {
  company: { name: string; dartCorpCode: string | null };
  dartFinancials: { available: boolean; year?: string; items?: Array<{ name: string; value: number; year?: string }>; reportUrl?: string; error?: string; fsDivLabel?: string; integrity?: string | null; integrityNotes?: string[] };
  /** 재무 데이터 출처 — DART / 신용평가자료 / 외부 검색 (구형 버전에는 없음) */
  dataSources?: { dart: boolean; dartYear: string | null; creditReport: string | null; webResearchCount: number };
  researchSources: SynergySourceRef[];
  financialStrengths: string[];
  financialWeaknesses: string[];
  businessAssessment: string;
  marketLinkage: {
    marketSummaries: Array<{ industry: string; cagrPct: number | null; gapPct: number | null; newDrivers: string[] }>;
    synergyAreas: Array<{ area: string; synergyType: string; rationale: string; opportunity: string; risk: string; sources: string[]; origin?: "llm" | "human" }>;
  };
  shortList: Array<{ rank: number; area: string; verdict: string; reason: string; origin?: "llm" | "human"; editedBy?: string | null; editedAt?: string | null }>;
  stepSummaries: SynergyStepSummary[];
  target?: { type: "affiliate" | "group"; name: string };
  opportunity?: { id: string; name: string } | null;
  synergyScore?: number | null;
  synergyRationale?: string | null;
  /** ADR-0094 — 재사용된 프로파일 딥링크 (상세 재무·SWOT는 /our-company 담당) */
  profileRef?: { kind: "affiliate" | "group"; id: string; label: string; profileVersion: number | null };
}
interface SynergyAnalysis {
  id: string; status: "in_progress" | "completed"; current_step: number;
  company_id?: string | null; member_id?: string | null; group_id?: string | null;
  company_name: string; dart_corp_code: string | null; source_ref?: string | null;
  created_at: string; completed_at: string | null; latest_version: number | null;
  rerun_in_progress?: number;
  error_message?: string | null;
  target_type?: "affiliate" | "group" | null;
  member_name?: string | null; group_name?: string | null;
  opportunity_id?: string | null; opportunity_name?: string | null;
  versions?: Array<{ version_no: number; payload: SynergyPayload | null; changelog: string | null; created_by: string; created_at: string }>;
}

/** 회사 묶음 키 — 같은 대상(계열사/그룹/legacy 회사)의 분석을 한 묶음으로 나열한다. */
function analysisGroupKey(a: SynergyAnalysis): string {
  return `${a.target_type ?? "legacy"}:${a.member_id ?? a.group_id ?? a.company_id ?? a.company_name}`;
}
/** 분석 대상 표기 — 신규(레지스트리)는 계열사/그룹명, legacy는 md_company 회사명 */
function targetLabel(a: Pick<SynergyAnalysis, "target_type" | "member_name" | "group_name" | "company_name">): string {
  if (a.target_type === "affiliate") return a.member_name ?? a.company_name;
  if (a.target_type === "group") return a.group_name ?? "그룹 전체";
  return a.company_name;
}

const STEP_TITLES = ["DART 재무 입수", "외부 리서치", "재무 강/약점 분석", "S1·S2 연계 시너지", "우선 시너지 영역 선별"];

// ADR-0094 역할 분리 — 재무 현황·강/약점 상세는 /our-company(그룹/계열사 분석)가
// 담당하고, /synergy는 시너지 고유 내용(연계 시너지·우선 시너지 영역)만 다룬다.
const TABS = [
  ["overview", "개요"],
  ["linkage", "연계 시너지"],
  ["shortlist", "우선 시너지 영역"],
  ["refs", "출처·노트"],
] as const;

type TabKey = (typeof TABS)[number][0];

export function SynergyView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [analyses, setAnalyses] = useState<SynergyAnalysis[] | null>(null);
  const [selected, setSelected] = useState<SynergyAnalysis | null>(null);
  const [detail, setDetail] = useState<SynergyAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [corpCode, setCorpCode] = useState("");
  // 새 분석 폼 — 대상(그룹/계열사 레지스트리) + 기회 연결 (ADR-0090)
  const [showNewForm, setShowNewForm] = useState(false);
  const [targets, setTargets] = useState<Array<{ kind: "affiliate" | "group"; id: string; label: string; groupName: string; hasProfile: boolean }>>([]);
  const [targetSel, setTargetSel] = useState<{ kind: "affiliate" | "group"; id: string } | null>(null);
  const [opps, setOpps] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [oppSel, setOppSel] = useState("");
  const [creating, setCreating] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useState<TabKey>("overview");

  const selectedId = searchParams.get("company");

  const refresh = useCallback(() => {
    loadTargets(); // 대상(그룹/계열사 프로파일) 목록 갱신 — ADR-0090
    return api.get<{ analyses: SynergyAnalysis[] }>("/api/synergy/analyses")
      .then((r) => { setAnalyses(r.data.analyses); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // URL(?company=) 기반 선택 — 상단 바 뒤로 가기와 연동
  useEffect(() => {
    if (!selectedId) {
      // 뒤로 가기(목록 복귀) — 선택 상태를 해제한다
      setSelected(null);
      setDetail(null);
      return;
    }
    if (analyses === null) return;
    const found = analyses.find((a) => a.id === selectedId) ?? null;
    setSelected(found);
    if (!found) { setDetail(null); return; }
    if (found.status === "completed") {
      api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(found.id)}`)
        .then((r) => setDetail(r.data))
        .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
    } else {
      setDetail(null);
    }
  }, [selectedId, analyses]);

  const hasInProgress = analyses?.some((a) => a.status === "in_progress" || !!a.rerun_in_progress) ?? false;
  useEffect(() => {
    if (!hasInProgress) return;
    const t = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(t);
  }, [hasInProgress, refresh]);

  // 선택한 회사의 분석이 완료되면 상세 리포트를 자동으로 활성화한다
  useEffect(() => {
    if (!selectedId || selected?.status !== "in_progress") return;
    const t = setInterval(async () => {
      try {
        const r = await api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(selectedId)}`);
        if (r.data.status === "completed") { setDetail(r.data); setSelected(r.data); }
      } catch { /* 다음 폴링에서 재시도 */ }
    }, 4000);
    return () => clearInterval(t);
  }, [selectedId, selected?.status]);

  const refreshDetail = useCallback((analysisId: string) => {
    return api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(analysisId)}`)
      .then((r) => setDetail(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  const openDetail = useCallback((a: SynergyAnalysis) => {
    router.replace(`/synergy?company=${encodeURIComponent(a.id)}`);
    setSelected(a);
    setDetail(null);
    if (a.status === "completed") {
      api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(a.id)}`)
        .then((r) => setDetail(r.data))
        .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
    }
  }, []);

  const loadTargets = useCallback(() => {
    api.get<{ groups: Array<{ id: string; name: string; member_count: number }> }>("/api/our-company/groups")
      .then(async (gr) => {
        const out: Array<{ kind: "affiliate" | "group"; id: string; label: string; groupName: string; hasProfile: boolean }> = [];
        for (const g of gr.data.groups) {
          const detail = await api.get<{ members: Array<{ id: string; company_name: string; latest_version: number | null }> }>(`/api/our-company/groups/${encodeURIComponent(g.id)}`);
          out.push({ kind: "group", id: g.id, label: `그룹 전체 (${g.name})`, groupName: g.name, hasProfile: detail.data.members.some((m) => m.latest_version !== null) });
          for (const m of detail.data.members) {
            out.push({ kind: "affiliate", id: m.id, label: m.company_name, groupName: g.name, hasProfile: m.latest_version !== null });
          }
        }
        setTargets(out);
      })
      .catch(() => setTargets([]));
    // GET /api/opportunities returns the rows array directly in `data` (same as
    // app/page.tsx) — parsing it as { rows } used to throw on undefined and the
    // .catch silently emptied the 기회 dropdown.
    api.get<Array<{ id: string; name: string; status: string }>>("/api/opportunities")
      .then((r) => setOpps(r.data))
      .catch(() => setOpps([]));
  }, []);

  async function createAnalysis() {
    if (!targetSel || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<{ analysis_id: string }>("/api/synergy/analyses", {
        targetType: targetSel.kind,
        memberId: targetSel.kind === "affiliate" ? targetSel.id : undefined,
        groupId: targetSel.kind === "group" ? targetSel.id : undefined,
        opportunityId: oppSel || undefined,
      });
      const list = await api.get<{ analyses: SynergyAnalysis[] }>("/api/synergy/analyses");
      setAnalyses(list.data.analyses);
      setShowNewForm(false);
      const created = list.data.analyses.find((x) => x.id === res.data.analysis_id);
      if (created) openDetail({ ...created, status: "in_progress" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석 시작 실패");
    } finally {
      setCreating(false);
    }
  }

  function removeAnalysis(a: SynergyAnalysis) {
    confirm(
      `${a.company_name} 시너지 분석 삭제`,
      async () => {
        setError(null);
        try {
          await api.delete(`/api/synergy/analyses/${encodeURIComponent(a.id)}`);
          if (selected?.id === a.id) backToList();
          refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "시너지 분석 삭제 실패");
        }
      },
      { body: "이 분석과 버전 전체가 삭제됩니다. 회사 마스터(그룹/계열사·프로젝트 연결)는 유지됩니다." },
    );
  }

  const backToList = useCallback(() => {
    router.replace("/synergy");
    setSelected(null);
    setDetail(null);
    void refresh();
  }, [refresh]);




  async function rerun(a: SynergyAnalysis) {
    setError(null);
    try {
      // ADR-0094 — 동일 분석 행을 재실행하고 파이프라인이 새 버전을 append한다.
      await api.post<{ analysis_id: string; reused: boolean }>(`/api/synergy/analyses/${encodeURIComponent(a.id)}/rerun`, {});
      openDetail({ ...a, status: "in_progress", latest_version: a.latest_version });
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "재분석 시작 실패");
    }
  }

  // ── 상세 (회사 선택 시) ──
  if (selected) {
    const selectedAnalysis = detail ?? selected;
    return (
      <main>
        {confirmDialog}
        <SynergyResult
          analysis={selectedAnalysis}
          tab={tab}
          onTab={(k) => setTab(k)}
          onBack={backToList}
          onRerun={() => rerun(selected)}
          onRefresh={() => refreshDetail(selectedAnalysis.id)}
        />
      </main>
    );
  }

  // ── 목록 (분석 대상 회사) ──
  return (
    <main>
      {confirmDialog}
      
      <StageFrame stageId="S3">
        그룹/계열사 분석에서 만든 자사 프로파일(특정 계열사 또는 그룹 전체)을 S1 시장분석·S2 기회발굴
        결과와 연결해 시너지 영역 후보를 도출하고 우선 시너지 영역으로 좁힙니다. 기회를 연결하면 완료 시 해당 기회에
        synergy_score 권고가 기록됩니다.
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      <section aria-label="분석 대상 회사" className="market-section">
        <SectionToolbar
          title="시너지 분석 목록"
          icon=""
          count={analyses?.length ?? 0}
          actions={
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowNewForm((v) => !v)}
              aria-expanded={showNewForm}
            >
              ＋ 새 분석
            </button>
          }
        />

        {analyses === null ? (
          <p>불러오는 중...</p>
        ) : analyses.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 시너지 분석이 없습니다. "회사 등록"으로 시작하세요.</p>
        ) : (
          <table className="data-table" aria-label="분석 대상 회사 목록">
            <caption className="sr-only">분석 대상 회사 목록</caption>
            <thead>
              <tr>
                <th scope="col">회사명</th>
                <th scope="col">연결 기회</th>
                <th scope="col">구분</th>
                <th scope="col">분석 상태</th>
                <th scope="col">분석일</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // 회사별 묶음 — 회사 셀은 그룹 첫 행에만 표시(rowSpan)하고
                // 기회는 행마다 나열된다 (가독성: 회사가 하나의 묶음으로 보임).
                const groups = new Map<string, SynergyAnalysis[]>();
                for (const a of analyses) {
                  const key = analysisGroupKey(a);
                  const list = groups.get(key) ?? [];
                  list.push(a);
                  groups.set(key, list);
                }
                const flat: Array<{ a: SynergyAnalysis; companyCell: SynergyAnalysis | null }> = [];
                for (const list of groups.values()) {
                  list.forEach((a, i) => flat.push({ a, companyCell: i === 0 ? a : null }));
                }
                return flat.map(({ a, companyCell }) => {
                const inProgress = a.status === "in_progress";
                return (
                  <tr key={a.id} className={selectedId === a.id ? "row-selected" : undefined}>
                    {companyCell !== null && (() => {
                      const groupLen = groups.get(analysisGroupKey(companyCell))!.length;
                      // 상세 진입은 연결 기회(행) 클릭이 담당 — 회사 셀은 묶음
                      // 헤더이며, 분석이 하나뿐인 경우에만 클릭으로 열린다.
                      return (
                        <td className="cell-primary align-top" rowSpan={groupLen}>
                          {groupLen === 1 ? (
                            <button
                              type="button"
                              className="font-semibold text-left underline-offset-2 hover:underline"
                              title="시너지 정합성 리포트 열기"
                              onClick={() => openDetail(companyCell)}
                            >
                              {targetLabel(companyCell)}
                            </button>
                          ) : (
                            <span className="font-semibold">{targetLabel(companyCell)}</span>
                          )}
                        </td>
                      );
                    })()}
                    <td>
                      {a.opportunity_name ? (
                        <button
                          type="button"
                          className="text-[0.8rem] text-left underline-offset-2 hover:underline"
                          title="시너지 정합성 리포트 열기"
                          onClick={() => openDetail(a)}
                        >
                          {a.opportunity_name}
                        </button>
                      ) : (
                        <span className="text-[0.75rem] text-[color:var(--muted-fg)]">— (시장 연계만)</span>
                      )}
                    </td>
                    <td>{a.target_type ? <span className="control-chip status-not-started">{a.target_type === "group" ? "그룹" : "계열사"}</span> : <span className="control-chip status-amber" title="기존 별도 등록 분석(legacy)">legacy</span>}</td>
                    <td>
                      {inProgress ? (
                        <span className="status-chip status-amber">분석 중 ({a.current_step}/5단계)</span>
                      ) : a.status === "completed" && a.rerun_in_progress ? (
                        // ADR-0132 — 재분석 진행 중에도 이전 완료 버전이 그대로 표시된다.
                        <span className="status-chip status-amber" title="이전 완료 버전은 그대로 표시되며, 재분석이 성공해야만 새 버전으로 교체됩니다.">재분석 중 (이전 v{a.latest_version ?? 1} 유지)</span>
                      ) : a.status === "completed" && a.error_message ? (
                        <span className="status-chip status-red" title={`${a.error_message} — 표시 중인 버전은 이전 완료 버전입니다.`}>재분석 실패 (v{a.latest_version ?? 1} 유지)</span>
                      ) : (
                        <span className="status-chip status-green">분석 완료 (v{a.latest_version ?? 1})</span>
                      )}
                    </td>
                    <td className="tabular-nums">{(a.completed_at ?? a.created_at).slice(0, 10)}</td>
                    <td className="sizing-actions-cell"><span className="actions-row">
                      <button type="button" className="btn-ghost btn-sm" disabled={inProgress} onClick={() => openDetail(a)}>
                        {inProgress ? "분석 중" : "열기"}
                      </button>
                      {!inProgress && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={!a.target_type}
                          title={a.target_type ? "같은 분석 행을 재사용해 새 버전으로 재실행합니다" : "기존 별도 등록(legacy) 분석은 재실행할 수 없습니다 — 레지스트리 대상 새 분석을 생성하세요"}
                          onClick={() => rerun(a)}
                        >
                          재분석
                        </button>
                      )}
                      <button type="button" className="btn-danger btn-sm" title="이 시너지 분석을 삭제합니다" onClick={() => removeAnalysis(a)}>
                        삭제
                      </button>
                    </span></td>
                  </tr>
                );
                });
              })()}
            </tbody>
          </table>
        )}
        {hasInProgress && <p className="mt-2 mb-0 text-[0.75rem] text-[color:var(--muted-fg)]" role="status">분석이 진행 중입니다 — 완료되면 목록이 자동으로 갱신됩니다.</p>}
      </section>

      {/* ── 새 분석 폼 (대상 = 그룹/계열사 레지스트리 · 기회 연결 — ADR-0090) ── */}
      {showNewForm && (
        <div className="sizing-new-form mb-3">
          <div className="mb-2">
            <span className="text-label block mb-1">① 분석 대상 — 그룹/계열사 분석에서 프로파일을 만든 대상</span>
            {targets.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic text-[0.85rem] mb-0">그룹/계열사 분석 화면에서 회사를 등록·분석하면 여기에 표시됩니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {targets.map((t) => (
                  <button
                    key={`${t.kind}-${t.id}`}
                    type="button"
                    aria-pressed={targetSel?.kind === t.kind && targetSel?.id === t.id}
                    disabled={!t.hasProfile}
                    title={t.hasProfile ? `${t.groupName} 그룹 · 프로파일 있음` : "프로파일이 없는 대상 — 그룹/계열사 분석을 먼저 실행하세요"}
                    className={`sizing-industry-chip ${targetSel?.kind === t.kind && targetSel?.id === t.id ? "sizing-industry-chip-active" : ""} ${!t.hasProfile ? "opacity-40" : ""}`}
                    onClick={() => { if (t.hasProfile) setTargetSel({ kind: t.kind, id: t.id }); }}
                  >
                    <span className="font-semibold">{t.kind === "group" ? "전체" : ""} {t.label}</span>
                    <span className="sizing-chip-meta">{t.hasProfile ? "프로파일 준비됨" : "프로파일 없음"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mb-2">
            <span className="text-label block mb-1">② 연결 기회 (선택) — S2에서 발굴한 기회를 선택하면 완료 시 synergy_score 권고가 기록됩니다</span>
            <select value={oppSel} onChange={(e) => setOppSel(e.target.value)} className="sizing-new-input" style={{ width: "100%" }}>
              <option value="">기회 없이 분석 (시장 연계만)</option>
              {opps.filter((o) => o.status !== "dropped").map((o) => (
                <option key={o.id} value={o.id}>[{o.status}] {o.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setShowNewForm(false)}>취소</button>
            <button type="button" className="btn-ghost" disabled={creating || !targetSel} onClick={() => void createAnalysis()}>
              {creating ? "분석 시작 중..." : "분석 시작"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function SynergyResult({ analysis, tab, onTab, onBack, onRerun, onRefresh }: {
  analysis: SynergyAnalysis;
  tab: TabKey;
  onTab: (k: TabKey) => void;
  onBack: () => void;
  onRerun: () => void;
  onRefresh: () => void;
}) {
  const latest = analysis.versions?.[0] ?? null;
  const p = latest?.payload ?? null;
  const inProgress = analysis.status === "in_progress";
  const ct = useChartTheme(); // 리포트 차트 테마 — 훅은 컴포넌트 최상위에서 1회
  const analysisDate = latest?.created_at?.slice(0, 10) ?? analysis.created_at.slice(0, 10);
  const router = useRouter();
  const { me } = useAuth();
  const canCurate = me?.role === "admin" || me?.role === "analyst";
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  // ADR-0125 — 연계 시너지 사람 추가 폼.
  const [showLinkageForm, setShowLinkageForm] = useState(false);
  const [linkageForm, setLinkageForm] = useState({ area: "", synergyType: "", rationale: "", opportunity: "", risk: "" });
  const [linkageSaving, setLinkageSaving] = useState(false);
  const [linkageError, setLinkageError] = useState<string | null>(null);

  async function addLinkageItem() {
    if (linkageSaving || !linkageForm.area.trim() || !linkageForm.synergyType.trim() || !linkageForm.rationale.trim()) return;
    setLinkageSaving(true); setLinkageError(null);
    try {
      await api.post(`/api/synergy/analyses/${encodeURIComponent(analysis.id)}/linkage-items`, {
        area: linkageForm.area.trim(), synergyType: linkageForm.synergyType.trim(), rationale: linkageForm.rationale.trim(),
        opportunity: linkageForm.opportunity.trim() || undefined, risk: linkageForm.risk.trim() || undefined,
      });
      setLinkageForm({ area: "", synergyType: "", rationale: "", opportunity: "", risk: "" });
      setShowLinkageForm(false);
      onRefresh();
    } catch (err) {
      setLinkageError(err instanceof Error ? err.message : "영역 추가 실패");
    } finally {
      setLinkageSaving(false);
    }
  }

  // ADR-0125 — 우선 시너지 영역 판정/사유 사람 편집 + 새 영역 추가.
  const [editingArea, setEditingArea] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ verdict: "Short List", reason: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [showShortlistForm, setShowShortlistForm] = useState(false);
  const [shortlistForm, setShortlistForm] = useState({ area: "", verdict: "Short List", reason: "" });

  async function saveShortlistItem(area: string, verdict: string, reason: string) {
    if (editSaving || !reason.trim()) return;
    setEditSaving(true); setEditError(null);
    try {
      await api.put(`/api/synergy/analyses/${encodeURIComponent(analysis.id)}/shortlist-items`, { area, verdict, reason: reason.trim() });
      setEditingArea(null);
      setShowShortlistForm(false);
      setShortlistForm({ area: "", verdict: "Short List", reason: "" });
      onRefresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "판정 저장 실패");
    } finally {
      setEditSaving(false);
    }
  }

  // S3 우선 시너지 영역 -> S4 route-decision handoff: mark the linked opportunity
  // "selected" and hand the synergy rationale to /route-decision as a
  // pre-fill starting point (editable, not locked).
  const opportunityId = p?.opportunity?.id ?? analysis.opportunity_id ?? null;
  const advanceToRouteDecision = useCallback(async () => {
    if (!opportunityId || advancing) return;
    setAdvancing(true);
    setAdvanceError(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}`, { status: "selected" });
      const rationale = p?.synergyRationale ?? "";
      router.push(`/route-decision?opportunity=${encodeURIComponent(opportunityId)}&rationale=${encodeURIComponent(rationale)}`);
    } catch (err) {
      setAdvanceError(err instanceof Error ? err.message : "S4 진행 실패");
    } finally {
      setAdvancing(false);
    }
  }, [opportunityId, advancing, p?.synergyRationale, router]);
  return (
    <section aria-label="시너지 정합성 리포트" className="market-section sizing-step">
      <SectionToolbar
        title={`${targetLabel(analysis)} 시너지 정합성 분석`}
        icon=""
        summary={
          <span className="flex items-center gap-1">
            <span className="section-meta">S3 시너지 영역 선별 · 분석일 {analysisDate} · v{latest?.version_no ?? analysis.latest_version ?? 1}</span>
            {analysis.opportunity_name && <span className="status-chip status-in-progress" title={`연결 기회: ${analysis.opportunity_name}`}>기회: {analysis.opportunity_name}</span>}
            {(() => {
              const score = latest?.payload?.synergyScore;
              return typeof score === "number" ? <span className="status-chip status-green">synergy 권고 {score}</span> : null;
            })()}
          </span>
        }
        actions={
          <>
            <ListBackButton onClick={onBack} />
            <button type="button" className="btn-ghost" disabled={inProgress} onClick={onRerun}>
              재분석
            </button>
          </>
        }
      />

      {inProgress && (
        <p className="text-[0.85rem]" role="status">
          분석 중 ({analysis.current_step}/5단계) — {STEP_TITLES[analysis.current_step] ?? ""} 진행 중입니다. 완료되면 자동 갱신됩니다.
        </p>
      )}
      {!p && !inProgress && <p className="text-[color:var(--muted-fg)] italic">분석 결과가 없습니다.</p>}

      {p && (
        <>
          <div className="library-tabs" role="tablist" aria-label="리포트 섹션">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={`library-tab ${tab === key ? "library-tab-active" : ""}`} onClick={() => onTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">◎</span> 프로파일 요약 — 상세는 그룹/계열사 분석 담당</h3>
              <div className="sizing-grade-card mb-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <strong className="text-[0.9rem]">{p.target?.name ?? p.company.name}</strong>
                  {p.dataSources?.dart && <span className="status-chip status-green">DART {p.dataSources.dartYear ?? ""}</span>}
                  {(p.financialStrengths?.length ?? 0) > 0 && <span className="status-chip status-in-progress">강점 {p.financialStrengths.length}건</span>}
                  {(p.financialWeaknesses?.length ?? 0) > 0 && <span className="status-chip status-not-started">약점 {p.financialWeaknesses.length}건</span>}
                  {p.profileRef && (
                    <a
                      href={p.profileRef.kind === "affiliate" ? `/our-company?member=${encodeURIComponent(p.profileRef.id)}` : "/our-company"}
                      className="text-[color:var(--accent)] underline text-[0.8rem]"
                    >
                      상세 프로파일 보기 →
                    </a>
                  )}
                </div>
                <p className="mb-0 text-[0.85rem]" style={{ whiteSpace: "pre-line" }}>{p.businessAssessment}</p>
              </div>
              {p.opportunity && (
                <div className="sizing-grade-card mb-3">
                  <h4 className="text-[0.85rem] mb-2">연결 기회 — S2 기회발굴</h4>
                  <p className="mb-1 text-[0.85rem]"><strong>{p.opportunity.name}</strong></p>
                  {p.synergyScore != null && (
                    <p className="mb-0 text-[0.82rem]">
                      시너지 점수 권고: <span className="status-chip status-amber">{p.synergyScore}점 (사람 확정 전 권고값)</span>
                      {p.synergyRationale && <span className="block mt-1 text-[color:var(--muted-fg)]">{p.synergyRationale}</span>}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "linkage" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">3</span> S1·S2 연계 시너지 영역 (후보 탐색 → 본검증)</h3>
              <p className="mb-2 text-[0.8rem] text-[color:var(--muted-fg)]">
                연계 시장: {p.marketLinkage.marketSummaries.map((m) => `${m.industry} (CAGR ${m.cagrPct ?? "?"}%${m.gapPct !== null ? `, 격차 ${m.gapPct > 0 ? "+" : ""}${m.gapPct}%` : ""})`).join(" · ") || "없음"}
              </p>
              <div className="table-scroll">
              <table className="data-table report-table" aria-label="시너지 영역">
                <caption className="sr-only">시너지 영역</caption>
                <thead>
                  <tr><th scope="col" className="col-label">영역</th><th scope="col" className="col-type">유형</th><th scope="col" className="col-text">근거</th><th scope="col" className="col-text">기회</th><th scope="col" className="col-text">위험</th><th scope="col" className="col-type">출처</th></tr>
                </thead>
                <tbody>
                  {p.marketLinkage.synergyAreas.map((a) => (
                    <tr key={a.area}>
                      <td className="font-semibold col-label">{a.area}</td>
                      <td className="text-[0.8rem] col-type">{a.synergyType}</td>
                      <td className="text-[0.85rem] col-text">{a.rationale}{a.sources.length > 0 && <span className="text-[color:var(--muted-fg)]"> (출처: {a.sources.join(", ")})</span>}</td>
                      <td className="text-[0.85rem] col-text">{a.opportunity}</td>
                      <td className="text-[0.85rem] col-text">{a.risk}</td>
                      <td className="col-type">
                        <span className={`status-chip ${a.origin === "human" ? "status-in-progress" : "status-not-started"}`}>
                          {a.origin === "human" ? "사람 추가" : "LLM 추천"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {canCurate && (
                <div className="mt-3">
                  {!showLinkageForm ? (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setShowLinkageForm(true)}>＋ 새 영역 추가</button>
                  ) : (
                    <div className="sizing-grade-card">
                      <div className="flex flex-wrap gap-2 mb-2">
                        <input className="sizing-new-input" style={{ flex: "1 1 12rem" }} placeholder="영역명 *" value={linkageForm.area} onChange={(e) => setLinkageForm({ ...linkageForm, area: e.target.value })} />
                        <input className="sizing-new-input" style={{ flex: "1 1 10rem" }} placeholder="유형 * (예: 매출 시너지)" value={linkageForm.synergyType} onChange={(e) => setLinkageForm({ ...linkageForm, synergyType: e.target.value })} />
                      </div>
                      <textarea className="sizing-new-input w-full mb-2" rows={2} placeholder="근거 *" value={linkageForm.rationale} onChange={(e) => setLinkageForm({ ...linkageForm, rationale: e.target.value })} />
                      <div className="flex flex-wrap gap-2 mb-2">
                        <input className="sizing-new-input" style={{ flex: "1 1 12rem" }} placeholder="기회 (선택)" value={linkageForm.opportunity} onChange={(e) => setLinkageForm({ ...linkageForm, opportunity: e.target.value })} />
                        <input className="sizing-new-input" style={{ flex: "1 1 12rem" }} placeholder="위험 (선택)" value={linkageForm.risk} onChange={(e) => setLinkageForm({ ...linkageForm, risk: e.target.value })} />
                      </div>
                      {linkageError && <p role="alert" className="text-[0.78rem] text-[color:var(--red-fg)] mb-2">{linkageError}</p>}
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => { setShowLinkageForm(false); setLinkageError(null); }}>취소</button>
                        <button type="button" className="btn-primary btn-sm" disabled={linkageSaving || !linkageForm.area.trim() || !linkageForm.synergyType.trim() || !linkageForm.rationale.trim()} onClick={() => void addLinkageItem()}>
                          {linkageSaving ? "추가 중..." : "추가"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "shortlist" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge sizing-step-badge-deep">4</span> 우선 시너지 영역 — 선별 결과</h3>
              <table className="data-table" aria-label="우선 시너지 영역">
                <caption className="sr-only">우선 시너지 영역</caption>
                <thead><tr><th scope="col">순위</th><th scope="col">영역</th><th scope="col">판정</th><th scope="col">사유</th><th scope="col">출처</th>{canCurate && <th scope="col"></th>}</tr></thead>
                <tbody>
                  {p.shortList.map((s) => {
                    const isEditing = editingArea === s.area;
                    return (
                      <tr key={s.area}>
                        <td className="tabular-nums font-semibold">{s.rank}</td>
                        <td className="font-semibold">{s.area}</td>
                        {isEditing ? (
                          <>
                            <td>
                              <select className="sizing-new-input sizing-new-input-sm" value={editForm.verdict} onChange={(e) => setEditForm({ ...editForm, verdict: e.target.value })}>
                                <option value="Short List">선별</option>
                                <option value="보류">보류</option>
                              </select>
                            </td>
                            <td>
                              <input className="sizing-new-input w-full" value={editForm.reason} onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })} />
                            </td>
                          </>
                        ) : (
                          <>
                            <td><span className={`status-chip ${s.verdict.includes("Short") ? "status-green" : "status-not-started"}`}>{s.verdict.includes("Short") ? "선별" : s.verdict}</span></td>
                            <td className="text-[0.85rem]">{s.reason}</td>
                          </>
                        )}
                        <td>
                          <span className={`status-chip ${s.origin === "human" ? "status-in-progress" : "status-not-started"}`} title={s.editedBy ? `${s.editedBy}가 수정 (${s.editedAt?.slice(0, 10) ?? ""})` : undefined}>
                            {s.origin === "human" ? "사람 추가" : s.editedBy ? "LLM 제안 · 사람 수정" : "LLM 추천"}
                          </span>
                        </td>
                        {canCurate && (
                          <td className="sizing-actions-cell">
                            {isEditing ? (
                              <span className="actions-row">
                                <button type="button" className="btn-ghost btn-sm" disabled={editSaving} onClick={() => setEditingArea(null)}>취소</button>
                                <button type="button" className="btn-primary btn-sm" disabled={editSaving || !editForm.reason.trim()} onClick={() => void saveShortlistItem(s.area, editForm.verdict, editForm.reason)}>
                                  {editSaving ? "저장 중..." : "저장"}
                                </button>
                              </span>
                            ) : (
                              <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditingArea(s.area); setEditForm({ verdict: s.verdict, reason: s.reason }); }}>수정</button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {editError && <p role="alert" className="text-[0.78rem] text-[color:var(--red-fg)] mt-1">{editError}</p>}
              {canCurate && (
                <div className="mt-3">
                  {!showShortlistForm ? (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setShowShortlistForm(true)}>＋ 새 영역 추가</button>
                  ) : (
                    <div className="sizing-grade-card">
                      <div className="flex flex-wrap gap-2 mb-2">
                        <input className="sizing-new-input" style={{ flex: "1 1 12rem" }} placeholder="영역명 *" value={shortlistForm.area} onChange={(e) => setShortlistForm({ ...shortlistForm, area: e.target.value })} />
                        <select className="sizing-new-input sizing-new-input-sm" value={shortlistForm.verdict} onChange={(e) => setShortlistForm({ ...shortlistForm, verdict: e.target.value })}>
                          <option value="Short List">선별</option>
                          <option value="보류">보류</option>
                        </select>
                      </div>
                      <input className="sizing-new-input w-full mb-2" placeholder="사유 *" value={shortlistForm.reason} onChange={(e) => setShortlistForm({ ...shortlistForm, reason: e.target.value })} />
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setShowShortlistForm(false)}>취소</button>
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          disabled={editSaving || !shortlistForm.area.trim() || !shortlistForm.reason.trim()}
                          onClick={() => void saveShortlistItem(shortlistForm.area.trim(), shortlistForm.verdict, shortlistForm.reason)}
                        >
                          {editSaving ? "추가 중..." : "추가"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!opportunityId && (
                <p className="mt-2 mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">
                  S4로 진행하려면 이 분석에 연결된 기회(S2)가 필요합니다 — 새 분석 시 "연결 기회"를 선택하세요.
                </p>
              )}
              {/* Screening gate — flow.spec S1~S3 gates: [screening]. S3 산출물이
                  모이는 이 화면에서 GO/HOLD/KILL을 기록한다 (ADR-0094 경계 #2:
                  기록 버튼은 사람의 몫). GO 기록이 곧 S4 진행 결정이므로, 별도
                  "S4로 진행" 버튼 없이 GO 기록 시 바로 opportunity를 selected로
                  표시하고 /route-decision으로 이동한다. */}
              {opportunityId && (
                <div className="mt-4">
                  <GateDecisionPanel
                    opportunityId={opportunityId}
                    gates={["screening"]}
                    onRecorded={(decision, gate) => {
                      if (decision === "go" && gate === "screening") void advanceToRouteDecision();
                    }}
                  />
                  <p className="mt-1 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
                    GO로 기록하면 이 검토/안건이 "selected"로 표시되고 S4 진출방식 결정으로 자동 이동합니다.{" "}
                    <a href={`/deals/${encodeURIComponent(opportunityId)}/s4`} className="text-[color:var(--accent)] underline">
                      지금 바로 S4로 이동 →
                    </a>
                  </p>
                </div>
              )}
              {advanceError && <p role="alert" className="text-[0.78rem] text-[color:var(--red-fg)] mt-1">{advanceError}</p>}
            </div>
          )}

          {tab === "refs" && (
            <div className="text-[0.88rem]">
              {p.researchSources.length > 0 && (
                <details className="market-section" open>
                  <summary className="cursor-pointer text-[0.85rem]">입수 출처 ({p.researchSources.length}건 — 출처 명기·교차검증)</summary>
                  <ul className="sizing-note-list mt-2">
                    {p.researchSources.map((s, i) => (
                      <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a><span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span></li>
                    ))}
                  </ul>
                </details>
              )}
              <details className="market-section" open>
                <summary className="cursor-pointer text-[0.85rem]">파이프라인 단계별 노트 ({p.stepSummaries.length}단계)</summary>
                <ol className="mt-3 space-y-2 text-[0.85rem]">
                  {p.stepSummaries.map((s) => (
                    <li key={s.step}><strong>{s.step}. {s.title}</strong> <span className={`status-chip ${s.source === "llm" ? "status-in-progress" : "status-not-started"}`}>{s.source === "llm" ? "LLM" : "시스템"}</span><br />{s.summary}</li>
                  ))}
                </ol>
              </details>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function SynergyPage() {
  return (
    <Suspense fallback={null}>
      <SynergyView />
    </Suspense>
  );
}
