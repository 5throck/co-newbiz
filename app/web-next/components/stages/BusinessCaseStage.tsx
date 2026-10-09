"use client";

// S8 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/business-case 페이지와
// /deals/[id]/s8 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.
// 탭 상태는 독립 페이지에서 URL ?tab= 동기, embedded(deals 탭) 모드에서는 내부 상태로
// 유지한다 — router로 프로젝트 페이지를 건드리지 않는다.

import Link from "next/link";
import { DevRef } from "../ui.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { StageTabs } from "../StageTabs.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { GateDecisionJump, GateDecisionPanel } from "../GateDecisionPanel.tsx";
import { TargetCheckPanel } from "../TargetCheckPanel.tsx";
import { StageFrame } from "../StageFrame.tsx";
import { TabNav } from "../TabNav.tsx";
import { WaccPanel } from "../wacc/WaccPanel.tsx";
import { ParamsPanel } from "../business-case/ParamsPanel.tsx";
import { TargetCostingPanel } from "../business-case/TargetCostingPanel.tsx";
import { FinancialAnalysisPanel } from "../FinancialAnalysisPanel.tsx";
import { useConfirm } from "../crud.tsx";
import { canWriteProject, isReadOnlyAdmin } from "../../lib/project-write-access.ts";
import { countLegacyUnassignedModels } from "../../lib/business-case-legacy.ts";

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
  target_id: string | null;
  target_name: string | null;
  source: "generated" | "manual";
  recommended: boolean;
  adopted: boolean;
  created_by: string;
  created_at: string;
  lines: LineRow[];
  simulations: SimRow[];
}
interface TargetComparisonRow {
  targetId: string;
  companyName: string;
  rank: number | null;
  baseP05: number | null;
  baseP50: number | null;
  irr: number | null;
  caseCount: number;
  recommended: boolean;
  engine: "python-sim-engine" | "ts-fallback" | "mixed" | null;
}
interface CasesResponse {
  cases: CaseView[];
  recommended_scenario: string | null;
  adoption: { modelId: string; adoptedBy: string; adoptedAt: string } | null;
  target_selection: { targetId: string; rationale: string; selectedBy: string; selectedAt: string } | null;
  targets: TargetComparisonRow[];
  engines_mixed?: boolean;
  escalated_cagr_pct: number | null;
}
interface ActivityRow {
  activityId: string;
  agentKey: string;
  status: string;
  outputMd: string | null;
}

const SCENARIOS = ["base", "upside", "downside"] as const;
const SCEN_LABEL: Record<string, string> = { base: "기본(Base)", upside: "상승(Upside)", downside: "하락(Downside)" };
const ENGINE_LABEL: Record<string, string> = { "python-sim-engine": "Python 엔진", "ts-fallback": "TS 대체 엔진", mixed: "혼합" };
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
  const tabParam = urlSync ? searchParams.get("tab") : localTab;
  const tab = tabParam === "decision" || tabParam === "overview" || tabParam === "params" || tabParam === "target-costing" || tabParam === "wacc" || tabParam === "financial-analysis" || tabParam === "targets" ? tabParam : "scenarios";
  const setTab = (key: string) => {
    if (urlSync) router.replace(`/projects/${projectId}/business-case?tab=${key}`, { scroll: false });
    else setLocalTab(key);
  };
  // Legacy deep links: the project page's stage row owns these two tabs now.
  useEffect(() => {
    if (!urlSync) return;
    if (tabParam === "wacc") router.replace(`/projects/${projectId}/wacc`);
    else if (tabParam === "financial-analysis") router.replace(`/projects/${projectId}/financial-analysis`);
  }, [urlSync, tabParam, projectId, router]);
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const readOnlyAdmin = isReadOnlyAdmin(me?.role);
  const { confirm, confirmDialog } = useConfirm();
  const [data, setData] = useState<CasesResponse | null>(null);
  // 에스컬레이션 조정 CAGR (§4-Q2) — 과거 기반 관점과의 괴리 경고용
  const [escalatedCagrPct, setEscalatedCagrPct] = useState<number | null>(null);
  const [run, setRun] = useState<{ runId: string; status: string; activities: ActivityRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ modelId: string; text: string } | null>(null);
  // ADR-0143 — brownfield 대상 축: 비교 탭의 선정 근거 입력과 시나리오
  // 매트릭스의 대상 필터. 기본 필터는 선정 대상(없으면 권고/1순위 대상).
  const [targetFilter, setTargetFilter] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<{ targetId: string; name: string } | null>(null);
  const [selectionRationale, setSelectionRationale] = useState("");
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

  // ADR-0143 — 대상 선정은 인간의 판단이며 근거 기록이 필수다 (경계 #2,
  // ADR-0053). 선정 시 md_project.company_id가 확정되고, 이후 채택은 선정된
  // 대상의 케이스로 제한된다.
  async function submitTargetSelection() {
    if (!selecting || !selectionRationale.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/target-selection`, {
        target_id: selecting.targetId,
        rationale: selectionRationale.trim(),
      });
      setSelecting(null);
      setSelectionRationale("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "대상 선정 실패");
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(() => {
    api.get<CasesResponse>(`/api/projects/${encodeURIComponent(projectId)}/business-case`)
      .then((r) => { setData(r.data); setEscalatedCagrPct(r.data.escalated_cagr_pct ?? null); })
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
      { body: "이 케이스를 타당성 분석(FS) 진행 입력으로 채택합니다. 채택은 인간 결정이며 감사 기록으로 남습니다." },
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

  // Group by scenario; within a scenario, market_forward (1차) first, newest
  // first. Brownfield (대상 축 존재)는 유효 대상 필터의 케이스만 보여준다 —
  // 기본값은 선정 대상, 없으면 첫 대상 (ADR-0143).
  const targets = data?.targets ?? [];
  const effectiveTargetFilter = useMemo(() => {
    if (targets.length === 0) return null;
    if (targetFilter && targets.some((t) => t.targetId === targetFilter)) return targetFilter;
    return data?.target_selection?.targetId ?? targets[0]?.targetId ?? null;
  }, [targets, targetFilter, data?.target_selection?.targetId]);
  const selectedTargetName = targets.find((t) => t.targetId === data?.target_selection?.targetId)?.companyName ?? null;

  const byScenario = useMemo(() => {
    const map = new Map<string, CaseView[]>();
    for (const s of SCENARIOS) {
      const list = (data?.cases ?? [])
        .filter((c) => c.scenario === s)
        .filter((c) => (targets.length === 0 ? c.target_id === null : c.target_id === effectiveTargetFilter))
        .sort((a, b) => (a.variant === b.variant ? b.created_at.localeCompare(a.created_at) : a.variant === "market_forward" ? -1 : 1));
      map.set(s, list);
    }
    return map;
  }, [data, targets.length, effectiveTargetFilter]);

  const hasHistorical = (data?.cases ?? []).some((c) => c.variant === "historical");

  // R2-E — legacy (pre-ADR-0143) unassigned models: visible only on a
  // shortlist-scoped project, where target_id NULL models cannot satisfy the
  // per-target S8 predicate. Detection only; the human regenerates.
  const legacyUnassignedCount = countLegacyUnassignedModels(data?.cases ?? [], targets);

  return (
<>
      <StageTabs projectId={projectId} />
      <GateDecisionJump gate="fs" beforeJump={() => setTab("decision")} />
      <StageFrame stageId="S8" heading="S8 사업성 분석 — 이중 관점 밸류에이션 비교">
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
        같은 시나리오를 <b>시장 기반(진행 판정 1차)</b>과 <b>과거 기반(비교 근거)</b> 두 관점으로 각각 평가해 나란히 비교합니다.
        <span className="ml-2 status-chip status-not-started">엔진 권고 ≠ 채택 — 채택은 사람의 행위입니다</span>
      </p>

      {readOnlyAdmin && (
        <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
          <span className="status-chip status-not-started mr-1">읽기 전용</span>
          관리자 역할은 프로젝트 데이터를 변경할 수 없어 대상 선택·채택·생성 기능이 표시되지 않습니다.
        </p>
      )}

      {/* R2-E — ADR-0143 이전 대상 미지정 모델 고지. 경고 토큰 + 텍스트(색만이 아님),
          재생성 액션이 1차 액션. 기존 모델은 절대 자동 삭제·이전하지 않는다. */}
      {legacyUnassignedCount > 0 && (
        <div className="legacy-model-notice" role="status">
          <span className="status-chip status-amber" aria-hidden="true">⚠ 주의</span>
          <p className="legacy-model-notice-text">
            ADR-0143 이전에 생성된 <b>대상 미지정 모델 {legacyUnassignedCount}건</b>이 있습니다 — 대상별 분석을 위해 재생성이 필요합니다.
            기존 모델은 보존되며 자동 삭제되지 않습니다.
          </p>
          {canAct && (
            <button type="button" className="btn-premium btn-sm" disabled={busy} onClick={() => void generate()}>
              {busy ? "재생성 중..." : "대상별 재생성"}
            </button>
          )}
        </div>
      )}

      {/* Content first: the compact, non-dismissible review strip sits above the analysis tabs and expands on demand. */}
      <ReviewBuckets entityType="project" entityId={projectId} gates={["fs"]} artifacts={stageArtifactTabs("S8")} />

      {canAct && tab !== "decision" && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void generate()}>
            {busy ? "계산 중..." : "밸류에이션 재계산"}
          </button>
          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {busy ? "계산 중입니다 - 완료되면 결과가 갱신됩니다." : "결정 기록은 위쪽 '결정 기록 (사람)' 또는 '결정' 탭에서 합니다."}
          </span>
        </div>
      )}

      {/* R2-E IA decision (2026-10-09): ONE tab row per surface. The project page keeps
          only the stage-level tabs (StageTabs); the analysis sub-tabs live there as
          ?tab= entries. The embedded deal tab has no StageTabs row, so it keeps this TabNav. */}
      {!embedded && (
        <p className="sr-only" id="s8-analysis-tabs-note">
          S8 분석 탭(대상 비교·설명·시나리오·파라미터·타겟코스팅·결정)은 위 단계 탭 행에서 선택합니다.
        </p>
      )}
      {embedded && (
      <TabNav
        className="mb-3"
        label="S8 사업성 분석 화면"
        active={tab}
        onSelect={setTab}
        tabs={[
          ...(targets.length > 0 ? [{ key: "targets", label: "대상 비교·선정" }] : []),
          { key: "overview", label: "설명·생성·권고" },
          { key: "scenarios", label: "시나리오 비교" },
          { key: "params", label: "파라미터·스냅샷" },
          { key: "target-costing", label: "타겟코스팅" },
          { key: "wacc", label: "WACC" },
          { key: "financial-analysis", label: "재무분석" },
          { key: "decision", label: "결정" },
        ]}
      />
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}

      {tab === "params" && <ParamsPanel projectId={projectId} />}
      {tab === "target-costing" && <TargetCostingPanel projectId={projectId} />}
      {tab === "wacc" && <WaccPanel projectId={projectId} />}
      {tab === "financial-analysis" && <FinancialAnalysisPanel projectId={projectId} />}

      {/* ── ADR-0143 대상 비교·선정 (brownfield) — 권고 ≠ 선정, 선정은 사람 ── */}
      {tab === "targets" && targets.length === 0 && (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)] mb-3" role="note">
          대상 축이 없는 프로젝트(greenfield)입니다 — 대상 비교·선정은 brownfield(Short List) 프로젝트에만 적용됩니다. 시나리오 비교 탭을 이용하세요.
        </p>
      )}
      {tab === "targets" && targets.length > 0 && (
      <section className="market-section sizing-step mb-3" aria-label="Short List 대상 비교·선정">
        <h3 className="sizing-step-title">Short List 대상 비교·선정 <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">(Short List 대상 전체)</span><DevRef refs="flow.spec S8 subjectScope: shortlist · ADR-0143" /></h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          각 대상의 최신 gate-primary(시장 기반) 기본 시나리오 결과를 비교합니다. ★ 권고안는 권고일 뿐이며, 선정은 근거를 남기는 사람의 기록입니다. 선정 후 채택은 선정된 대상의 케이스로 제한됩니다.
        </p>
        {selectedTargetName && (
          <p className="text-[length:var(--fs-caption)] mb-2">
            <span className="status-chip status-green">선정됨</span> <b>{selectedTargetName}</b> — 근거: {data?.target_selection?.rationale}{" "}
            <span className="text-[color:var(--muted-fg)]">({data?.target_selection?.selectedBy})</span>
          </p>
        )}
        <div className="table-scroll"><table className="data-table">
          <thead>
            <tr>
              <th scope="col">대상</th>
              <th scope="col" className="num">S7 순위</th>
              <th scope="col" className="num">Base NPV p05</th>
              <th scope="col" className="num">Base NPV p50</th>
              <th scope="col" className="num">IRR</th>
              <th scope="col" className="num">케이스</th>
              <th scope="col">계산 엔진</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => {
              const isSelected = data?.target_selection?.targetId === t.targetId;
              return (
                <tr key={t.targetId}>
                  <td>
                    <b>{t.companyName}</b>
                    {t.recommended && <span className="status-chip status-green ml-1" title="정량 방법론 권고 — 최악 분위수(p05) 생존 관점 (시장 기반)">★ 권고안</span>}
                    {isSelected && <span className="status-chip status-green ml-1">선정됨</span>}
                  </td>
                  <td className="num">{t.rank ?? "—"}</td>
                  <td className="num mono-num">{t.baseP05 !== null ? fmt(t.baseP05) : "—"}</td>
                  <td className="num mono-num">{t.baseP50 !== null ? fmt(t.baseP50) : "—"}</td>
                  <td className="num mono-num">{t.irr != null ? `${(t.irr * 100).toFixed(1)}%` : "—"}</td>
                  <td className="num">{t.caseCount}</td>
                  <td><span className="status-chip status-not-started">{ENGINE_LABEL[t.engine ?? ""] ?? "엔진 미기록"}</span></td>
                  <td>
                    {canAct && !isSelected && (
                      <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => { setSelecting({ targetId: t.targetId, name: t.companyName }); setSelectionRationale(""); }}>
                        대상 선택
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {data?.engines_mixed && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">
            * 비교된 케이스가 서로 다른 계산 엔진에서 산출되었으므로 순위는 유의하여 해석하세요.
          </p>
        )}
        {targets.every((t) => t.caseCount === 0) && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">아직 분석된 케이스가 없습니다 — 설명·생성 탭에서 대상별 자동 생성을 실행하세요.</p>
        )}
        {selecting && (
          <div className="mt-2">
            <p className="text-[length:var(--fs-caption)] mb-1"><b>{selecting.name}</b> 대상 선정 근거 (필수 — 결정 기록으로 남습니다):</p>
            <textarea
              className="sizing-new-input w-full"
              rows={3}
              value={selectionRationale}
              onChange={(e) => setSelectionRationale(e.target.value)}
              spellCheck={false}
              aria-label="대상 선정 근거"
            />
            <div className="flex gap-1 mt-1">
              <button type="button" className="btn-ghost btn-sm" disabled={busy || !selectionRationale.trim()} onClick={() => void submitTargetSelection()}>선정 기록</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSelecting(null)}>취소</button>
            </div>
          </div>
        )}
      </section>
      )}

      {tab === "overview" && (
      <>
      {/* 두 관점의 의미 */}
      <section className="market-section sizing-step mb-3" aria-label="두 관점의 의미">
        <h3 className="sizing-step-title">두 관점의 의미</h3>
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th scope="col">관점</th><th scope="col">성장률 근거</th><th scope="col">변동성(sigma) 근거</th><th scope="col">쓰임</th></tr></thead>
          <tbody>
            <tr>
              <td><span className="status-chip status-green">market_forward · 1차</span> 시장 기반</td>
              <td>시장 성장률 (opportunity)</td>
              <td>미래 변동성 프로파일 — 과거 매출 변동성 + WACC 자산 변동성 블렌딩</td>
              <td>S8 완료·킬 크라이테리아·권고안 판정</td>
            </tr>
            <tr>
              <td><span className="status-chip status-amber">historical · 비교</span> 과거 기반</td>
              <td>대상 회사 매출 CAGR (DART)</td>
              <td>과거 매출 증감률 표준편차</td>
              <td>&quot;과거 실적이 지속되면&quot; 관점의 비교 근거</td>
            </tr>
          </tbody>
        </table></div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
          <b className="text-[color:var(--warning)]">진행 판정(채택 요건·킬 크라이테리아·권고안)은 시장 기반 값을 사용합니다.</b>{" "}
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
          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">생성 실행 로그 ({run.runId} — {run.status})</summary>
          <ul className="sizing-note-list mt-1">
            {run.activities.map((a) => (
              <li key={a.activityId}>
                <span className={`status-chip ${a.status === "done" ? "status-green" : a.status === "failed" ? "status-red" : "status-not-started"}`}>{a.status}</span>{" "}
                <strong>{a.activityId}</strong> <span className="text-[color:var(--muted-fg)]">({a.agentKey})</span>
                {a.outputMd && <pre className="text-[length:var(--fs-caption)] whitespace-pre-wrap mt-1">{a.outputMd}</pre>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ── LLM 채택 권고 (결정 지원) — ADR-0118: 제안은 LLM, 채택은 사람 ── */}
      {canAct && (
        <section className="market-section sizing-step mt-3" aria-label="LLM 채택 권고">
          <h3 className="sizing-step-title text-[0.9rem]">🤖 LLM 채택 권고 (제안)</h3>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            원칙 (경계 #2): 채택은 사람이 합니다 — 이 화면의 케이스들과 킬 크라이테리아 상태에서 만든 제안이며, ★ 권고안(결정론)와 별개 제안입니다.
          </p>
          {recoError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
          {!reco && !recoLoading && !recoError && (
            <div className="flex flex-wrap items-center gap-2 mb-0">
              <button type="button" className="btn-ghost" onClick={() => void generateAdoptionReco()}>▶ 채택 권고 생성</button>
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">권고 케이스와 근거, "무엇이 바뀌면 뒤집히는가" 초안을 작성합니다.</span>
            </div>
          )}
          {recoLoading && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">케이스 수치와 킬 크라이테리아를 근거로 초안을 작성하는 중...</p>}
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
              {reco.note && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{reco.note}</p>}
              {reco.recommendation.rationale_draft && <p className="text-[length:var(--fs-caption)] mb-1"><span className="font-semibold">채택 근거 초안:</span> {reco.recommendation.rationale_draft}</p>}
              {reco.recommendation.what_would_change && <p className="text-[length:var(--fs-caption)] mb-1"><span className="font-semibold">권고가 뒤집히는 조건:</span> {reco.recommendation.what_would_change}</p>}
              {reco.recommendation.cautions.length > 0 && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mb-1">⚠ {reco.recommendation.cautions.join(" / ")}</p>
              )}
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">이 제안이 본 산출물: {reco.manifest.join(" · ")}</p>
            </>
          )}
        </section>
      )}
      </>
      )}

      {/* 시나리오별 이중 관점 비교 — brownfield는 유효 대상 필터의 케이스만 */}
      {tab === "scenarios" && (
      <>
      {targets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mt-3 mb-1" role="group" aria-label="분석 대상 필터">
          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mr-1">분석 대상:</span>
          {targets.map((t) => (
            <button
              key={t.targetId}
              type="button"
              className={t.targetId === effectiveTargetFilter ? "btn-ghost btn-sm" : "btn-ghost btn-sm"}
              onClick={() => setTargetFilter(t.targetId)}
            >
              {t.companyName}{data?.target_selection?.targetId === t.targetId ? " ✓" : ""}
            </button>
          ))}
        </div>
      )}
      {SCENARIOS.map((s) => {
        const cases = byScenario.get(s) ?? [];
        const newestMf = cases.find((c) => c.variant === "market_forward");
        const newestMfP50 = newestMf?.simulations.find((x) => x.percentile === "p50")?.npv_krw_m ?? null;
        return (
          <section key={s} className="market-section sizing-step mt-3" aria-label={`${SCEN_LABEL[s]} 이중 관점 비교`}>
            <h3 className="sizing-step-title">
              {SCEN_LABEL[s]}
              {newestMf?.recommended && <span className="status-chip status-green ml-1" title="정량 방법론 권고 — 최악 분위수(p05) 생존 관점 (시장 기반)">★ 권고안</span>}
              {newestMf?.adopted && <span className="status-chip status-green ml-1">채택됨 (fs 진행 입력)</span>}
            </h3>
            {cases.length === 0 ? (
              <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">
                이 시나리오의 케이스가 없습니다 — 자동 생성을 실행하세요.
              </p>
            ) : (
              <div className="table-scroll"><table className="data-table">
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
                          <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]"> {note.growth_source ?? ""}</span>
                          {c.variant === "historical" && note.growth && escalatedCagrPct !== null && Math.abs(Number(note.growth) * 100 - escalatedCagrPct) > 15 && (
                            <span
                              className="status-chip status-amber ml-1"
                              title={`에스컬레이션 조정 CAGR(${escalatedCagrPct.toFixed(1)}%)와 과거 CAGR의 차이가 15%p를 넘습니다 — 성장 가정의 불확실성 신호입니다.`}
                            >
                              ⚠ 조정치와 {(Number(note.growth) * 100 - escalatedCagrPct).toFixed(1)}%p 차이
                            </span>
                          )}
                        </td>
                        <td>
                          {note.sigma ? pct1(Number(note.sigma)) : "—"}
                          <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]"> {note.sigma_source ?? ""}</span>
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
                                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => adopt(c.id, c.scenario, c.variant)}>
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
                      <td colSpan={9} className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                        과거 기반 관점 N/A — 대상 회사 연결 + DART 동기화 후 재생성하면 추가됩니다.{" "}
                        <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("financial-analysis")}>재무분석 탭에서 연결 →</button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table></div>
            )}
            {(cases[0]?.simulations?.[0]?.note) && (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" title="재현 근거 (동일 시드로 재계산해도 같은 결과)">{cases[0].simulations[0].note}</p>
            )}
          </section>
        );
      })}
      </>
      )}

      {data && data.cases.length === 0 && (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">등록된 Business Case가 없습니다 — 자동 생성을 실행하거나 수동으로 추가하세요.</p>
      )}

      {editing && (
        <section className="market-section sizing-step mt-3" aria-label="라인 편집">
          <h3 className="sizing-step-title text-[0.9rem]">라인 편집 (JSON — 저장 시 전체 교체)</h3>
          <textarea
            className="sizing-new-input w-full font-mono text-[length:var(--fs-caption)]"
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
      {tab === "decision" && (
        <div className="mt-4">
          <GateDecisionPanel
            opportunityId={projectId}
            gates={["fs"]}
            entityType="project"
            showReview={false}
            nextStage={{ label: "S9 실사·검증", href: `/projects/${projectId}/dd` }}
          />
        </div>
      )}
      </StageFrame>
      {confirmDialog}
</>
  );
}

