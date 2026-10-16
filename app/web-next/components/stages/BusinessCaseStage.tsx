"use client";

// S8 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/business-case 페이지와
// /deals/[id]/s8 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.
// 탭 상태는 독립 페이지에서 URL ?tab= 동기, embedded(deals 탭) 모드에서는 내부 상태로
// 유지한다 — router로 프로젝트 페이지를 건드리지 않는다.

import { fmtNpvKrwM } from "@/lib/npv-format";
import Link from "next/link";
import { ColGroup, DevRef } from "../ui.tsx";

// 케이스 비교 11열 — 대상·계산 엔진·구조 교차검증·EV/매출 배수가 텍스트 열, 나머지는 수치.
const CASE_COMPARE_COL_PCT = [12, 7, 9, 9, 7, 7, 9, 13, 13, 8, 6] as const;
// 시나리오 케이스 10열 — 관점·성장률·sigma 출처와 수치 열.
const SCENARIO_CASE_COL_PCT = [11, 14, 9, 9, 9, 9, 6, 12, 11, 10] as const;
// Green Field는 중앙값 차이·페이드 DCF(교차검증) 열이 없다 — 과거 기반이 없어 두 열이
// 항상 "—"가 되는 정리(2026-10-16). 8열로 재분배해 콜그룹 합계 100을 유지한다.
const SCENARIO_CASE_COL_PCT_GF = [11, 14, 9, 9, 9, 9, 6, 33] as const;
// 중앙값 차이(시장 기반 대비)가 이 비율을 넘으면 설명 문구를 덧붙인다 — 계산 버그가
// 아니라 설계된 교차검증 신호(공통 배수, 성장 가정 차이가 지배)임을 사용자에게 알리기 위함.
// XCHECK_DIVERGENCE_WARN_RATIO(lib/business-case-generator.ts)와 같은 0.5 기준.
const P50_GAP_WARN_RATIO = 0.5;
import TargetSelector from "../TargetSelector.tsx";
import { KRW_MILLIONS_UNIT, formatKrwMillionsPlain } from "../../lib/format.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { StageTabs } from "../StageTabs.tsx";
import { S8LensStrip } from "./S8LensStrip.tsx";
import { S8PartHeader } from "./S8PartHeader.tsx";
import { TechnicalLensPanel } from "./TechnicalLensPanel.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { GateDecisionJump, GateDecisionPanel } from "../GateDecisionPanel.tsx";
import { TargetCheckPanel } from "../TargetCheckPanel.tsx";
import { AiJudgementSupport } from "../AiJudgementSupport.tsx";
import { StageFrame } from "../StageFrame.tsx";
import { TabNav } from "../TabNav.tsx";
import { WaccPanel } from "../wacc/WaccPanel.tsx";
import { ParamsPanel } from "../business-case/ParamsPanel.tsx";
import { S5ConnectBlock } from "../business-case/S5ConnectBlock.tsx";
import { TargetCostingPanel } from "../business-case/TargetCostingPanel.tsx";
import { ValuationMethodology } from "../business-case/ValuationMethodology.tsx";
import { FinancialAnalysisPanel } from "../FinancialAnalysisPanel.tsx";
import { RowMenu, useConfirm } from "../crud.tsx";
import { canWriteProject, isReadOnlyAdmin } from "../../lib/project-write-access.ts";
import { countLegacyUnassignedModels, hideHistoricalForGreenfield } from "../../lib/business-case-legacy.ts";
import { GoalPromptDialog, GoalsPanel, type GoalsData } from "../business-case/GoalsPanel.tsx";
import { GOALS_ACK_REQUIRED_CODE, goalsAckErrorText, goalsLoadErrorText, partOfS8Tab, primaryKeyOfS8Tab, resolveS8Tab, shouldRedirectTargetsTab, type CaseAttainmentEntry } from "../../lib/business-goals-view.ts";
import { GoalAttainmentTable } from "../business-case/GoalAttainment.tsx";

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
  anchorMethod: "company_revenue" | "market_capture" | null;
  xcheckFadeNpv?: number | null;
  xcheckFadeIrr?: number | null;
  xcheckDivergence?: number | null;
  structureMismatch?: boolean;
  acqEvRevenue?: number | null;
  acqEvRevenueInBand?: boolean | null;
  acqEvBandSource?: "confirmed" | "none";
}
interface EvBandConfirmed {
  min: number;
  max: number;
  rationale: string;
  source: string;
  confirmedBy: string;
  confirmedAt: string;
}
interface EvRevenueBandPayload {
  confirmed: EvBandConfirmed | null;
  reference: { min: number; max: number; label: string; sourced: boolean };
  optimismFlag: boolean;
  spreadFlag?: boolean;
  stale?: boolean;
  ageDays?: number | null;
}
// Mirrors XCHECK_DIVERGENCE_WARN_RATIO / ACQUISITION_EV_REVENUE_BAND in lib/business-case-generator.ts
// (that module imports the DB and cannot be bundled into a client component).
// ACQ_BAND is only the fallback for the unsourced global reference; the payload's evRevenueBand.reference wins.
const XCHECK_WARN_PCT = 50;
const ACQ_BAND = { min: 2, max: 6 } as const;
interface LegacyModelRow {
  id: string;
  name: string;
  scenario: string | null;
  variant: "market_forward" | "historical";
  created_at: string;
  referenced: boolean;
}
interface CasesResponse {
  cases: CaseView[];
  legacy_models?: LegacyModelRow[];
  recommended_scenario: string | null;
  adoption: { modelId: string; adoptedBy: string; adoptedAt: string } | null;
  target_selection: { targetId: string; rationale: string; selectedBy: string; selectedAt: string } | null;
  targets: TargetComparisonRow[];
  /** 2026-10-16: the S5 plan in force carries no capex line at all (drives the IRR no-flow chip; Green Field only). */
  s5_plan_capex_zero?: boolean;
  evRevenueBand?: EvRevenueBandPayload;
  engines_mixed?: boolean;
  methods_mixed?: boolean;
  escalated_cagr_pct: number | null;
  /** 2026-10-16: source opportunity id — builds the S5 투자비 탭 deep link (read-only lines view). */
  source_opportunity_id?: string | null;
  /** ADR-0159: per-case goal attainment keyed by case id (absent/empty = no goals). */
  goal_attainment?: Record<string, CaseAttainmentEntry[]>;
  goal_count?: number;
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
// 라인 읽기 전용 표의 분류 표기 (라인 category는 5종 — labor/opex/capex/revenue/gov_rnd).
const LINE_CATEGORY_LABEL: Record<string, string> = { labor: "인건비", opex: "운영비", capex: "설비투자", revenue: "매출", gov_rnd: "정부 R&D" };

const fmt = formatKrwMillionsPlain;
const UnitNote = () => <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-normal block">({KRW_MILLIONS_UNIT})</span>;
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
  const [localTab, setLocalTab] = useState("overview");
  // Bumped after an S5 connect / update / disconnect so the calculation-chain explanation reloads its parameters.
  const [s5ConnectVersion, setS5ConnectVersion] = useState(0);
  const tabParam = urlSync ? searchParams.get("tab") : localTab;
  // Greenfield (no target axis) hides the target compare/select tab; old deep links land on overview (ADR-0159).
  const [greenfield, setGreenfield] = useState(false);
  const tab = resolveS8Tab(tabParam, { greenfield });
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
  useEffect(() => {
    if (urlSync && shouldRedirectTargetsTab(tabParam, greenfield)) router.replace(`/projects/${projectId}/business-case?tab=overview`, { scroll: false });
  }, [urlSync, tabParam, greenfield, projectId, router]);
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const readOnlyAdmin = isReadOnlyAdmin(me?.role);
  const { confirm, confirmDialog } = useConfirm();
  const [data, setData] = useState<CasesResponse | null>(null);
  const [goalsData, setGoalsData] = useState<GoalsData | null>(null);
  // Adoption without goals needs an explicit acknowledgement (409 goals_ack_required).
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  const [goalsLoadError, setGoalsLoadError] = useState<string | null>(null);
  // 에스컬레이션 조정 CAGR (§4-Q2) — 과거 기반 관점과의 괴리 경고용
  const [escalatedCagrPct, setEscalatedCagrPct] = useState<number | null>(null);
  const [run, setRun] = useState<{ runId: string; status: string; activities: ActivityRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ modelId: string; text: string; label: string } | null>(null);
  const editorSectionRef = useRef<HTMLElement>(null);
  const editorTextRef = useRef<HTMLTextAreaElement>(null);
  // ADR-0178 (decider decision 2026-10-16): Green Field 라인 읽기 전용 보기 — JSON 편집기 대신
  // 라인 표 + S5 투자비 탭 안내. pin이 재평가 필요 상태면 S5 연결 블록의 `최신 S5로 갱신` 안내를 덧붙인다.
  const [viewing, setViewing] = useState<{ modelId: string; label: string; lines: LineRow[] } | null>(null);
  const [pinStale, setPinStale] = useState(false);
  const viewingSectionRef = useRef<HTMLElement>(null);
  const viewingModelId = viewing?.modelId ?? null;
  useEffect(() => {
    if (!viewingModelId) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    viewingSectionRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [viewingModelId]);
  // ADR-0143 — brownfield 대상 축: 비교 탭의 선정 근거 입력과 시나리오
  // 매트릭스의 대상 필터. 기본 필터는 선정 대상(없으면 권고/1순위 대상).
  const [targetFilter, setTargetFilter] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<{ targetId: string; name: string } | null>(null);
  const [selectionRationale, setSelectionRationale] = useState("");
  const [rationalePrefill, setRationalePrefill] = useState<{ text: string; nonce: number } | null>(null);

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
      .then((r) => { setData({ ...r.data, cases: hideHistoricalForGreenfield(r.data.cases, r.data.targets.length === 0) }); setGreenfield(r.data.targets.length === 0); setEscalatedCagrPct(r.data.escalated_cagr_pct ?? null); })
      .catch((e) => setError(e instanceof Error ? e.message : "사업성 분석 데이터를 불러오지 못했습니다."));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const loadGoals = useCallback(() => {
    api.get<GoalsData>(`/api/projects/${encodeURIComponent(projectId)}/business-goals`)
      .then((r) => { setGoalsData(r.data); setGoalsLoadError(null); })
      .catch((e) => { setGoalsData(null); setGoalsLoadError(goalsLoadErrorText(e, "사업 목표를 불러오지 못했습니다.")); }); // INTERIM-WORDING; goals are reference evidence: a failed load never blocks S8
  }, [projectId]);
  useEffect(() => { loadGoals(); }, [loadGoals]);
  const onGoalsChanged = useCallback(() => { loadGoals(); load(); }, [loadGoals, load]);

  // regenerate=true — "대상별 재생성": bypasses the already-run guard and
  // starts a NEW generation run (per-target models, ADR-0143). The ordinary
  // path keeps the idempotency guard and surfaces alreadyRun instead of
  // silently doing nothing.
  async function generate(regenerate = false) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ runId: string; alreadyRun?: boolean }>(
        `/api/projects/${encodeURIComponent(projectId)}/business-case/generate`,
        regenerate ? { regenerate: true } : {},
      );
      // IA cleanup 2026-10-14: ONE generate entry. The first press keeps the
      // already-run guard; when it reports an existing run, the SAME press
      // escalates to `regenerate: true` so a second entry point is not needed.
      let runId = r.data.runId;
      if (!regenerate && r.data.alreadyRun) {
        const again = await api.post<{ runId: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/business-case/generate`,
          { regenerate: true },
        );
        runId = again.data.runId;
      }
      const status = await api.get<{ runId: string; status: string; activities: ActivityRow[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/business-case/generate/${encodeURIComponent(runId)}`,
      );
      setRun({ runId: status.data.runId, status: status.data.status, activities: status.data.activities });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "자동 생성 실패");
    } finally {
      setBusy(false);
    }
  }

  async function postAdopt(modelId: string, goalsAck?: { acknowledged: true; note: string }) {
    setBusy(true); setError(null); setAckError(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/business-case/adopt`, { model_id: modelId, ...(goalsAck ? { goals_ack: goalsAck } : {}) });
      setAckFor(null);
      load();
    } catch (e) {
      // ADR-0159: no goals apply -> a confirmation requirement, not a block. The note is mandatory (400 goals_ack_note_required).
      const noteProblem = goalsAckErrorText(e);
      if (noteProblem) { setAckFor(modelId); setAckError(noteProblem); }
      else if ((e as { code?: string } | null)?.code === GOALS_ACK_REQUIRED_CODE) setAckFor(modelId);
      else setError(e instanceof Error ? e.message : "채택 실패");
    } finally {
      setBusy(false);
    }
  }

  function adopt(modelId: string, scenario: string | null, variant: string) {
    confirm(
      `사업 케이스 채택${scenario ? ` — ${SCEN_LABEL[scenario] ?? scenario} · ${VARIANT_LABEL[variant] ?? variant}` : ""}`,
      () => { void postAdopt(modelId); },
      { body: "이 케이스를 타당성 분석(FS) 진행 입력으로 채택합니다. 채택은 인간 결정이며 감사 기록으로 남습니다." },
    );
  }

  // ADR-0178: Green Field는 라인을 편집하지 않는다 — 읽기 전용 보기 + S5 투자비 탭 안내.
  // pin 재평가 필요 여부는 params GET의 s5_pin 상태로만 판단(표시 전용).
  function startView(c: CaseView) {
    const label = `${c.target_name ?? "대상 미지정"} · ${c.scenario ? `${SCEN_LABEL[c.scenario] ?? c.scenario} · ` : ""}${VARIANT_LABEL[c.variant] ?? c.variant}`;
    setViewing({ modelId: c.id, label, lines: c.lines });
    setPinStale(false);
    api.get<{ s5_pin?: { pin: unknown; state: string } | null }>(`/api/projects/${encodeURIComponent(projectId)}/business-case/params`)
      .then((r) => {
        const pin = r.data.s5_pin ?? null;
        setPinStale(!!pin?.pin && pin.state === "stale");
      })
    .catch(() => setPinStale(false));
  }

  function startEdit(c: CaseView) {
    const label = `${c.target_name ?? "대상 미지정"} · ${c.scenario ? `${SCEN_LABEL[c.scenario] ?? c.scenario} · ` : ""}${VARIANT_LABEL[c.variant] ?? c.variant}`;
    setEditing({ modelId: c.id, text: JSON.stringify(c.lines.map(({ id: _id, ...l }) => l), null, 2), label });
  }

  // The editor renders below all tables: bring it into view and focus it so the row action visibly works.
  const editingModelId = editing?.modelId ?? null;
  useEffect(() => {
    if (!editingModelId) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    editorSectionRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    editorTextRef.current?.focus({ preventScroll: true });
  }, [editingModelId]);

  function closeEditor() {
    const id = editing?.modelId;
    setEditing(null);
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-case-id="${id}"] .row-menu-trigger`)?.focus());
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      const lines = JSON.parse(editing.text) as Array<{ category: string; name: string; annual_amount_krw_m: number; start_year?: number; growth_rate?: number; note?: string }>;
      await api.put(`/api/projects/${encodeURIComponent(projectId)}/business-case`, { model_id: editing.modelId, lines });
      closeEditor();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "라인 저장 실패 (JSON 형식·category 값을 확인하세요)");
    } finally {
      setBusy(false);
    }
  }

  function remove(c: CaseView) {
    const modelId = c.id;
    const targetLabel = c.target_name ?? "대상 미지정";
    confirm(
      `Business Case 삭제 — 대상: ${targetLabel}`,
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
      { body: `대상: ${targetLabel} · ${c.scenario ? `${SCEN_LABEL[c.scenario] ?? c.scenario} · ` : ""}${VARIANT_LABEL[c.variant] ?? c.variant}. 선택한 대상의 모델이 맞는지 확인하세요. 라인·시뮬레이션 행을 포함해 삭제합니다.`, confirmLabel: "삭제" },
    );
  }

  // ADR-0158 — 예전(대상 미지정) 모델 정리: 미참조는 삭제, 참조된 모델(채택·게이트 근거)은 보관.
  function cleanupLegacy(models: LegacyModelRow[], all: boolean) {
    const toArchive = models.filter((m) => m.referenced).length;
    const toDelete = models.length - toArchive;
    confirm(
      all ? `예전 모델 ${models.length}건 정리` : `예전 모델 정리 — ${models[0]?.name ?? ""}`,
      () => {
        void (async () => {
          setBusy(true); setError(null);
          try {
            await api.post(`/api/projects/${encodeURIComponent(projectId)}/business-case/legacy-cleanup`, { model_ids: models.map((m) => m.id) });
            load();
          } catch (e) {
            setError(e instanceof Error ? e.message : "예전 모델 정리 실패");
          } finally {
            setBusy(false);
          }
        })();
      },
      { body: `미참조 ${toDelete}건은 삭제(감사 기록 포함), 채택·게이트 근거로 참조된 ${toArchive}건은 삭제하지 않고 보관합니다. 대상이 지정된 모델은 건드리지 않습니다.`, confirmLabel: "정리" },
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
  const evBand = data?.evRevenueBand;
  const sourceOppId = data?.source_opportunity_id ?? null; // ADR-0178: S5 investment-tab deep link (Green Field only)
  const refBand = evBand?.reference ?? ACQ_BAND;
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

  // One attainment table in the goals tab: every filtered case (all scenarios) as a column,
  // header "시나리오 · 관점" so the per-case columns stay readable outside the scenario layout.
  const attainmentCases = useMemo(
    () => SCENARIOS.flatMap((s) => (byScenario.get(s) ?? []).map((c) => ({ id: c.id, header: `${SCEN_LABEL[s]} · ${VARIANT_LABEL[c.variant]}` }))),
    [byScenario],
  );

  // Goal counts: the goals endpoint is authoritative; the cases payload is the fallback.
  const goalCount = goalsData
    ? goalsData.goal_count_by_source.project + goalsData.goal_count_by_source.affiliate + goalsData.goal_count_by_source.group
    : data?.goal_count ?? 0;

  const hasHistorical = (data?.cases ?? []).some((c) => c.variant === "historical");

  // R2-E — legacy (pre-ADR-0143) unassigned models: visible only on a
  // shortlist-scoped project, where target_id NULL models cannot satisfy the
  // per-target S8 predicate. Detection only; the human regenerates.
  const legacyUnassignedCount = countLegacyUnassignedModels(data?.cases ?? [], targets);
  const legacyModels = data?.legacy_models ?? [];

  return (
<>
      <StageTabs projectId={projectId} />
      {/* The jump chip is the 결정 tab's shortcut — hidden when already there (IA cleanup 2026-10-14). */}
      {tab !== "decision" && <GateDecisionJump gate="fs" beforeJump={() => setTab("decision")} />}
      <StageFrame stageId="S8" heading={greenfield ? "S8 사업성 분석 — 시장 기반 밸류에이션" : "S8 사업성 분석 — 이중 관점 밸류에이션 비교"}>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
        {greenfield ? (
          <>시나리오마다 <b>시장 기반(진행 판정 1차)</b> 관점으로 평가합니다. 성장은 시장 규모와 시장점유율에서 오며, 대상 회사가 없어 과거 실적과의 비교는 없습니다.</>
        ) : (
          <>같은 시나리오를 <b>시장 기반(진행 판정 1차)</b>과 <b>과거 기반(비교 근거)</b> 두 관점으로 각각 평가해 나란히 비교합니다.</>
        )}
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
            자동으로 삭제되지 않으며, 아래 목록에서 사람이 직접 정리합니다.
          </p>
          {canAct && (
            <button type="button" className="btn-premium btn-sm" disabled={busy} onClick={() => void generate(true)}>
              {busy ? "재생성 중..." : "대상별 재생성"}
            </button>
          )}
          {legacyModels.length > 0 && (
            <div className="legacy-model-list">
              <table className="data-table" aria-label="예전 모델 목록">
                <caption className="sr-only">대상 미지정 예전 모델 — 참조 여부와 정리 방식</caption>
                <thead>
                  <tr><th scope="col">모델</th><th scope="col">시나리오 · 관점</th><th scope="col">생성일</th><th scope="col">참조</th>{canAct && <th scope="col">정리</th>}</tr>
                </thead>
                <tbody>
                  {legacyModels.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{m.scenario ? `${SCEN_LABEL[m.scenario] ?? m.scenario} · ` : ""}{VARIANT_LABEL[m.variant] ?? m.variant}</td>
                      <td className="tabular-nums">{m.created_at.slice(0, 10)}</td>
                      <td>{m.referenced ? <span className="status-chip status-amber">참조됨 — 보관</span> : <span className="status-chip status-not-started">미참조 — 삭제</span>}</td>
                      {canAct && (
                        <td>
                          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => cleanupLegacy([m], false)} aria-label={`예전 모델 정리 — ${m.name}`}>
                            예전 모델 정리
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {canAct && (
                <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => cleanupLegacy(legacyModels, true)}>
                  예전 모델 정리 (전체 {legacyModels.length}건)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Content first: the compact, non-dismissible review strip sits above the analysis tabs and expands on demand. */}
      <ReviewBuckets entityType="project" entityId={projectId} gates={["fs"]} artifacts={stageArtifactTabs("S8")} />

      {/* R2-E IA decision (2026-10-09): ONE tab row per surface. The project page keeps
          only the stage-level tabs (StageTabs); the analysis sub-tabs live there as
          ?tab= entries. The embedded deal tab has no StageTabs row, so it keeps this TabNav.
          IA cleanup 2026-10-14: the global regeneration row and its sr-only tab note
          were removed — generation has ONE entry, the overview tab. */}
      {embedded && (
      <>
      <TabNav
        className="mb-3"
        label="S8 사업성 분석 화면"
        active={primaryKeyOfS8Tab(tab) ?? tab}
        onSelect={(k) => setTab(k === "financial" ? "overview" : k)}
        tabs={[
          { key: "goals", label: "사업 목표" }, // INTERIM-WORDING
          { key: "technical", label: "기술적 타당성" }, // INTERIM-WORDING
          { key: "financial", label: "재무적 타당성" }, // INTERIM-WORDING
          ...(targets.length > 0 ? [{ key: "targets", label: "대상 비교·선정" }] : []),
          { key: "decision", label: "결정" },
        ]}
      />
      {partOfS8Tab(tab) === "financial" && (
        <TabNav
          className="mb-3"
          label="재무적 타당성 하위 화면"
          active={tab}
          onSelect={setTab}
          tabs={[
            { key: "overview", label: "설명·생성·권고" },
            { key: "scenarios", label: "시나리오 비교" },
            { key: "wacc", label: "WACC" },
            { key: "financial-analysis", label: "재무분석" },
            { key: "params", label: "파라미터·스냅샷" },
            { key: "target-costing", label: "타겟코스팅" },
          ]}
        />
      )}
      </>
      )}
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}

      {tab === "goals" && <S8PartHeader part="goals" />}
      {tab === "technical" && <><S8PartHeader part="technical" /><TechnicalLensPanel projectId={projectId} /></>}
      {partOfS8Tab(tab) === "financial" && <S8PartHeader part="financial" />}
      {tab === "goals" && <GoalsPanel projectId={projectId} data={goalsData} canAct={canAct} onChanged={onGoalsChanged} loadError={goalsLoadError} />}
      {/* IA cleanup 2026-10-14: ONE attainment table (was one per scenario section),
          in its single home — the goals tab. Per-case columns are kept. */}
      {tab === "goals" && (
        <GoalAttainmentTable
          cases={attainmentCases}
          attainment={data?.goal_attainment}
          goalCount={goalCount}
        />
      )}
      {tab === "params" && <ParamsPanel projectId={projectId} onOpenTargets={() => setTab("targets")} />}
      {tab === "target-costing" && <TargetCostingPanel projectId={projectId} />}
      {tab === "wacc" && <WaccPanel projectId={projectId} />}
      {tab === "financial-analysis" && <FinancialAnalysisPanel projectId={projectId} />}

      {/* ── ADR-0143 대상 비교·선정 (brownfield) — 권고 ≠ 선정, 선정은 사람 ── */}
      {tab === "targets" && targets.length === 0 && (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)] mb-3" role="note">
          대상 축이 없는 프로젝트(greenfield)입니다 — 대상 비교·선정은 brownfield(최종 후보 목록) 프로젝트에만 적용됩니다. 시나리오 비교 탭을 이용하세요.
        </p>
      )}
      {tab === "targets" && targets.length > 0 && (
      <section className="market-section sizing-step mb-3" aria-label="최종 후보 목록 대상 비교·선정">
        <h3 className="sizing-step-title">최종 후보 목록 대상 비교·선정 <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">(최종 후보 목록 대상 전체)</span><DevRef refs="flow.spec S8 subjectScope: shortlist · ADR-0143" /></h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          각 대상의 최신 게이트 기준(시장 기반) 기본 시나리오 결과를 비교합니다. ★ 권고안는 권고일 뿐이며, 선정은 근거를 남기는 사람의 기록입니다. 선정 후 채택은 선정된 대상의 케이스로 제한됩니다.
        </p>
        {selectedTargetName && (
          <p className="text-[length:var(--fs-caption)] mb-2">
            <span className="status-chip status-green">선정됨</span> <b>{selectedTargetName}</b> — 근거: {data?.target_selection?.rationale}{" "}
            <span className="text-[color:var(--muted-fg)]">({data?.target_selection?.selectedBy})</span>
          </p>
        )}
        <div className="mb-2 grid gap-1" aria-label="EV/매출 밴드 상태">
          {evBand?.confirmed ? (
            <p className="text-[length:var(--fs-caption)]" role="note">
              <span className="status-chip status-green mr-1"><span aria-hidden="true">✓</span> 사람이 확정한 밴드</span>
              <b className="mono-num">{evBand.confirmed.min}–{evBand.confirmed.max}×</b> — 근거: {evBand.confirmed.rationale} · 출처: {evBand.confirmed.source}{" "}
              <span className="text-[color:var(--muted-fg)]">(확정: {evBand.confirmed.confirmedBy}, {evBand.confirmed.confirmedAt})</span>
              <span className="text-[color:var(--muted-fg)]"> · 참고(글로벌): {refBand.min}–{refBand.max}× — 이 영역의 근거 없음, 참고용</span>
            </p>
          ) : (
            <p className="text-[length:var(--fs-caption)]" role="note">
              <span className="status-chip status-not-started mr-1"><span aria-hidden="true">ⓘ</span> 밴드 미확정</span>
              범위 내/밖 판정은 표시하지 않습니다. 참고: 글로벌 로보틱스·자동화 M&amp;A {refBand.min}–{refBand.max}× (이 영역의 근거 없음, 참고용). 파라미터·스냅샷 탭에서 사람이 근거와 함께 확정할 수 있습니다.
            </p>
          )}
          {evBand?.spreadFlag && evBand.confirmed && (
            <p className="status-chip status-amber" role="note">
              <span aria-hidden="true">⚠</span> 확정 밴드 폭이 넓습니다 (상한/하한 {(evBand.confirmed.max / evBand.confirmed.min).toFixed(1)}배 &gt; 4.5배) — 밴드가 너무 느슨하지 않은지 점검하세요. (경고일 뿐 순위·저장에 영향 없음)
            </p>
          )}
          {evBand?.stale && evBand.confirmed && (
            <p className="status-chip status-amber" role="note">
              <span aria-hidden="true">⏱</span> 재확인 필요 — 확정 후 {evBand.ageDays}일 경과 (확정일 {evBand.confirmed.confirmedAt}). 알림일 뿐 순위에는 영향이 없습니다.
            </p>
          )}
          {evBand?.confirmed && data?.methods_mixed && (
            <p className="status-chip status-amber" role="note">
              <span aria-hidden="true">⚠</span> 평가 기준이 서로 다른 대상이 섞여 있어 밴드 판정을 대상 간에 비교할 수 없습니다.
            </p>
          )}
          {evBand?.confirmed && data?.target_selection && data.target_selection.selectedBy === evBand.confirmed.confirmedBy && (
            <p className="status-chip status-amber" role="note">
              <span aria-hidden="true">⚠</span> 밴드를 확정한 사람과 대상을 선정한 사람이 같습니다 ({evBand.confirmed.confirmedBy}) — 다른 검토자의 확인을 권장합니다. (표시 전용, 진행을 막지 않습니다)
            </p>
          )}
          {evBand?.optimismFlag && evBand.confirmed && (
            <p className="status-chip status-amber" role="note">
              <span aria-hidden="true">⚠</span> 확정 상한 {evBand.confirmed.max}×가 글로벌 참고 상한({refBand.max}×)의 1.5배를 넘습니다 — 낙관 편향 여부를 점검하세요. (경고일 뿐 순위·저장에 영향 없음)
            </p>
          )}
        </div>
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}><table className="data-table table-fixed-pct tmin-80">
          <ColGroup widths={CASE_COMPARE_COL_PCT} />
          <thead>
            <tr>
              <th scope="col">대상</th>
              <th scope="col" className="num">S7 순위</th>
              <th scope="col" className="num">기본 NPV 하위 5%<UnitNote /></th>
              <th scope="col" className="num">기본 NPV 중앙값<UnitNote /></th>
              <th scope="col" className="num">IRR <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-normal block">(%)</span></th>
              <th scope="col" className="num">케이스</th>
              <th scope="col">계산 엔진</th>
              <th scope="col" title="페이드 DCF(성장률이 선형 수렴하는 대안 구조) NPV가 기본 구조 중앙값과 얼마나 벌어지는지 — 표시 전용이며 순위에 반영되지 않습니다.">구조 교차검증<span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-normal block">(페이드 DCF 대 중앙값)</span></th>
              <th scope="col" title="생성기가 진입(acq_ev)과 처분(exit_ev)에 같은 배수를 적용하므로 진입 전용 배수가 아닌 가정치입니다. 사람이 확정한 프로젝트 밴드가 있을 때만 범위 내/밖을 표시하며, 글로벌 2–6배는 이 영역의 근거가 없는 참고값입니다. 가격 적정성 판단이 아니며 표시 전용으로 순위에 반영되지 않습니다.">가정 EV/매출 배수 (진입=처분)</th>
              <th scope="col" title="이 대상의 케이스가 어떤 매출 기준으로 평가되었는가 — 회사 실적 앵커(DART 연매출)와 시장 점유율 폴백(시장규모 × 시장점유율)이 섞이면 하위 5% 기준 순위 비교가 부적합합니다.">평가 기준</th>
              <th scope="col" className="min-w-[calc(var(--space-8)*3)]"><span className="sr-only">작업</span></th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => {
              const isSelected = data?.target_selection?.targetId === t.targetId;
              return (
                <tr key={t.targetId}>
                  <td>
                    <b>{t.companyName}</b>
                    {t.recommended && <span className="status-chip status-green ml-1" title="정량 방법론 권고 — 최악 분위수(하위 5%) 생존 관점 (시장 기반)">★ 권고안</span>}
                    {isSelected && <span className="status-chip status-green ml-1">선정됨</span>}
                  </td>
                  <td className="num">{t.rank ?? "—"}</td>
                  <td className="num mono-num">{t.baseP05 !== null ? fmtNpvKrwM(t.baseP05) : "—"}</td>
                  <td className="num mono-num">{t.baseP50 !== null ? fmtNpvKrwM(t.baseP50) : "—"}</td>
                  <td className="num mono-num">{t.irr != null ? `${(t.irr * 100).toFixed(1)}%` : "—"}</td>
                  <td className="num">{t.caseCount}</td>
                  <td><span className="status-chip status-not-started whitespace-nowrap">{ENGINE_LABEL[t.engine ?? ""] ?? "엔진 미기록"}</span></td>
                  <td className="num min-w-[calc(var(--space-8)*5)]">
                    {t.xcheckDivergence != null ? (
                      <>
                        <span className="mono-num">{t.xcheckDivergence >= 0 ? "+" : "−"}{Math.abs(t.xcheckDivergence * 100).toFixed(1)}%</span>
                        {t.xcheckFadeNpv != null && t.baseP50 != null && (
                          <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] block">
                            차이 {t.xcheckFadeNpv - t.baseP50 >= 0 ? "+" : "−"}{fmtNpvKrwM(Math.abs(t.xcheckFadeNpv - t.baseP50))} (페이드 NPV {fmtNpvKrwM(t.xcheckFadeNpv)})
                          </span>
                        )}
                      </>
                    ) : t.recommended ? (
                      <span className="status-chip status-amber" title="이 ★ 권고 대상에는 페이드 DCF 교차검증이 기록되지 않았습니다. 기록이 없다는 것은 검증되었다는 뜻이 아닙니다.">
                        <span aria-hidden="true">⚠</span> 교차검증 없음
                      </span>
                    ) : (
                      <span aria-label="해당 없음: 교차검증 기록 없음" title="이 케이스에는 페이드 DCF 교차검증이 기록되지 않았습니다.">N/A</span>
                    )}
                    {t.structureMismatch && (
                      <span className="status-chip status-amber block mt-1" role="note">
                        <span aria-hidden="true">⚠</span> 구조 불일치 — 페이드 DCF가 기본 p50과 {XCHECK_WARN_PCT}% 넘게 벌어집니다. 성장률·처분 배수 가정을 검토하세요.
                      </span>
                    )}
                  </td>
                  <td className="num min-w-[calc(var(--space-8)*5)]">
                    {t.acqEvRevenue != null ? (
                      <>
                        <span className="mono-num">{t.acqEvRevenue.toFixed(1)}×</span>
                        {evBand?.confirmed && t.acqEvRevenueInBand != null ? (
                          <span
                            className={`status-chip block mt-1 whitespace-nowrap ${t.acqEvRevenueInBand ? "status-not-started" : "status-amber"}`}
                            title={`사람이 확정한 프로젝트 밴드 ${evBand.confirmed.min}–${evBand.confirmed.max}× 기준의 참고 표시이며 가격 적정성 판단이 아닙니다. 근거: ${evBand.confirmed.rationale} · 출처: ${evBand.confirmed.source} · 확정: ${evBand.confirmed.confirmedBy}, ${evBand.confirmed.confirmedAt}${evBand.stale ? ` · 재확인 필요: 확정 후 ${evBand.ageDays}일 경과 (알림일 뿐 순위에 영향 없음)` : ""}${data?.methods_mixed ? " · 평가 기준이 다른 대상 간에는 밴드 판정을 비교할 수 없습니다." : ""}`}
                          >
                            <span aria-hidden="true">{t.acqEvRevenueInBand ? "ⓘ" : "⚠"}</span>{" "}
                            {t.acqEvRevenueInBand ? `확정 밴드 ${evBand.confirmed.min}–${evBand.confirmed.max}× 범위 내 (참고 표시)` : `확정 밴드 ${evBand.confirmed.min}–${evBand.confirmed.max}× 범위 밖 — 확인 필요`}
                            {evBand.stale && <> · <span aria-hidden="true">⏱</span> 재확인 필요</>}
                          </span>
                        ) : (
                          <span
                            className="status-chip status-not-started block mt-1 whitespace-nowrap"
                            aria-label={`밴드 미확정. 참고: 글로벌 로보틱스·자동화 M&A ${refBand.min}에서 ${refBand.max}배, 이 영역의 근거 없음`}
                            title="사람이 확정한 프로젝트 밴드가 없어 범위 내/밖 판정을 하지 않습니다."
                          >
                            <span aria-hidden="true">ⓘ</span> 밴드 미확정
                          </span>
                        )}
                      </>
                    ) : (
                      <span aria-label="해당 없음: 인수가 기반 배수 없음" title="인수가 기반으로 평가되지 않은 케이스입니다.">N/A</span>
                    )}
                  </td>
                  <td className="min-w-[calc(var(--space-8)*5)]">
                    {t.anchorMethod === "company_revenue" && (
                      <span className="status-chip status-green whitespace-nowrap" title="대상 회사 최신 연매출(DART)을 매출 앵커로 평가 — 대상 간 비교 가능">실적 앵커 (DART)</span>
                    )}
                    {t.anchorMethod === "market_capture" && (
                      <span className="status-chip status-amber whitespace-nowrap" title="회사 실적이 연결되지 않아 시장규모 × 시장점유율 폴백으로 평가 — 실적 앵커 대상과는 기준이 다릅니다. 재무분석 탭에서 회사 연결 후 재생성하세요.">시장 점유율 폴백</span>
                    )}
                    {!t.anchorMethod && <span className="status-chip status-not-started whitespace-nowrap">미평가</span>}
                  </td>
                  <td className="min-w-[calc(var(--space-8)*3)]">
                    {canAct && !isSelected && (
                      <button type="button" className="btn-ghost btn-sm whitespace-nowrap" disabled={busy} onClick={() => { setSelecting({ targetId: t.targetId, name: t.companyName }); setSelectionRationale(""); }}>
                        대상 선택
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">
          * 구조 교차검증과 가정 EV/매출 배수 열은 표시 전용이며 순위·★ 권고안에 반영되지 않습니다. 글로벌 2–6× 범위는 이 영역의 근거가 없는 참고값이며, 범위 내/밖 표시는 사람이 확정한 프로젝트 밴드에 대해서만 나타나고 가격 적정성 판단이 아닙니다. 권고는 제안일 뿐이며 대상 선정은 사람이 근거를 남겨 결정합니다.
          {data?.methods_mixed && " 평가 기준이 대상마다 다르므로 교차검증 괴리율은 대상 간에 비교할 수 없습니다."}
        </p>
        {data?.engines_mixed && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">
            * 비교된 케이스가 서로 다른 계산 엔진에서 산출되었으므로 순위는 유의하여 해석하세요.
          </p>
        )}
        {data?.methods_mixed && (
          <p className="text-[length:var(--fs-caption)] mt-1" role="alert">
            <span className="status-chip status-amber mr-1">⚠ 평가 기준 불일치</span>
            비교 대상의 평가 기준이 섞여 있습니다 — 일부 대상이 <b>회사 실적 앵커</b>(DART 연매출)가 아닌 <b>시장 점유율 폴백</b>(시장규모 × 시장점유율)으로 평가되어
            p05 순위·★ 권고안 비교가 부적합합니다. 재무분석 탭에서 해당 대상의 회사를 연결한 뒤 재생성하세요.
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
      {/* S5 connection status + human-only connect actions sit directly above the primary action (decider feedback 2026-10-16) */}
      {greenfield && <S5ConnectBlock projectId={projectId} canAct={canAct} onChanged={() => setS5ConnectVersion((v) => v + 1)} />}
      {/* Primary action of the tab sits first (decider feedback 2026-10-15) */}
      {canAct && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-premium btn-sm" disabled={busy} onClick={() => void generate()}>
            {busy ? "생성 중..." : greenfield ? "자동 생성 (시장 기반 × 3 시나리오)" : "이중 관점 자동 생성 (시장 기반 + 과거 기반 × 3 시나리오)"}
          </button>
          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {busy ? "계산 중입니다 - 완료되면 결과가 갱신됩니다." : "결정 기록은 '결정' 탭에서 합니다."}
          </span>
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

      {/* 두 관점의 의미 — greenfield has no target company, so only the market-based perspective exists */}
      {greenfield ? (
      <section className="market-section sizing-step mb-3" aria-label="평가 관점의 의미">
        <h3 className="sizing-step-title">평가 관점의 의미</h3>
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}><table className="data-table">
          <thead><tr><th scope="col">관점</th><th scope="col">성장률 근거</th><th scope="col">변동성(sigma) 근거</th><th scope="col">쓰임</th></tr></thead>
          <tbody>
            <tr>
              <td><span className="status-chip status-green">market_forward · 1차</span> 시장 기반</td>
              <td>시장 성장률 (opportunity)</td>
              <td>미래 변동성 프로파일 — 시장 기반 변동성과 WACC 자산 변동성 블렌딩</td>
              <td>S8 완료·킬 크라이테리아·권고안 판정</td>
            </tr>
          </tbody>
        </table></div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
          과거 기반 비교는 대상 회사가 있는 Brown Field에만 적용됩니다.
        </p>
      </section>
      ) : (
      <>
      {/* 두 관점의 의미 */}
        <section className="market-section sizing-step mb-3" aria-label="두 관점의 의미">
          <h3 className="sizing-step-title">두 관점의 의미</h3>
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}><table className="data-table">
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
      </>
      )}

      {/* 기업가치 계산 방법 — 계산 사슬 공개 (사용자 요청 2026-10-10) */}
      <ValuationMethodology
        key={s5ConnectVersion}
        projectId={projectId}
        marketCase={(byScenario.get("base") ?? []).find((c) => c.variant === "market_forward") ?? null}
        historicalCase={(byScenario.get("base") ?? []).find((c) => c.variant === "historical") ?? null}
        greenfield={greenfield}
      />

      {/* AI 채택 권고 lives in the decision tab's "AI 판단 지원" (one section for both AI proposals). */}
      {canAct && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-3" role="note">
          AI 채택 권고는 결정 탭의 AI 판단 지원에서 확인합니다.{" "}
          <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("decision")}>결정 탭 →</button>
        </p>
      )}
      </>
      )}

      {/* 시나리오별 이중 관점 비교 — brownfield는 유효 대상 필터의 케이스만.
          IA cleanup 2026-10-14: capability content lives in the technical tab —
          this is only a pointer (each fact gets ONE home). */}
      {tab === "scenarios" && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-3" role="note">
          <span className="status-chip status-not-started mr-1"><span aria-hidden="true">ⓘ</span> 역량</span>
          필요 역량 달성 가능성 판정은{" "}
          <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("technical")}>기술적 타당성 탭 →</button>
        </p>
      )}
      {tab === "scenarios" && (
      <>
      {targets.length > 1 && (
        <div className="mt-3 mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">분석 대상:</span>
          <TargetSelector
            targets={targets.map((t) => ({ targetId: t.targetId, name: t.companyName, companyId: t.targetId, isBound: data?.target_selection?.targetId === t.targetId }))}
            selected={effectiveTargetFilter}
            onSelect={setTargetFilter}
            ariaLabel="분석 대상 필터"
          />
        </div>
      )}
      {/* W1-19/W2-07: the goals tab owns the 목표 미설정 state — no callout here. */}
      {SCENARIOS.map((s) => {
        const cases = byScenario.get(s) ?? [];
        const newestMf = cases.find((c) => c.variant === "market_forward");
        const newestMfP50 = newestMf?.simulations.find((x) => x.percentile === "p50")?.npv_krw_m ?? null;
        return (
          <section key={s} className="market-section sizing-step mt-3" aria-label={greenfield ? `${SCEN_LABEL[s]} 시장 기반 평가` : `${SCEN_LABEL[s]} 이중 관점 비교`}>
            <h3 className="sizing-step-title">
              {SCEN_LABEL[s]}
              {newestMf?.recommended && <span className="status-chip status-green ml-1" title="정량 방법론 권고 — 최악 분위수(하위 5%) 생존 관점 (시장 기반)">★ 권고안</span>}
              {newestMf?.adopted && <span className="status-chip status-green ml-1">채택됨 (fs 진행 입력)</span>}
            </h3>
            {cases.length === 0 ? (
              <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">
                이 시나리오의 케이스가 없습니다 — 자동 생성을 실행하세요.
              </p>
            ) : (
              <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}><table className="data-table table-fixed-pct tmin-56">
                <ColGroup widths={greenfield ? SCENARIO_CASE_COL_PCT_GF : SCENARIO_CASE_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">관점</th>
                    <th scope="col">성장률 <span className="text-[color:var(--muted-fg)]">(출처)</span></th>
                    <th scope="col">변동성 sigma <span className="text-[color:var(--muted-fg)]">(출처)</span></th>
                    <th scope="col" className="num">NPV 하위 5%<UnitNote /></th>
                    <th scope="col" className="num">NPV 중앙값<UnitNote /></th>
                    <th scope="col" className="num">NPV 상위 5%<UnitNote /></th>
                    <th scope="col" className="num">IRR <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-normal block">(%)</span></th>
                    {!greenfield && <th scope="col" className="num">중앙값 차이<span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-normal block">({KRW_MILLIONS_UNIT}, 시장 기반 대비 %)</span></th>}
                    {!greenfield && <th scope="col" className="num" title="이중 구조 교차검증 — 같은 케이스를 고전 장기창구 DCF로 재평가: 명시적 창구(기본 10년) 안에서 성장률이 말기 성장률(기본 3%)로 선형 수렴하고 마지막 해에 동일 배수로 처분한 결정론적 NPV. 기본 구조(5년 홀드+exit)와 크게 어긋나면 성장-배수 가정이 불일치한다는 신호.">페이드 DCF 중앙값<UnitNote /></th>}
                    <th scope="col"><span className="sr-only">작업</span></th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => {
                    const p50 = c.simulations.find((x) => x.percentile === "p50");
                    const note = parseNote(p50?.note);
                    const irrV = p50?.irr ?? null;
                    // 2026-10-16: IRR이 null인 이유가 "투자 플로우 없음"(S5 계획에 capex 0 →
                    // flows[0]=0 → 부호 변화 없음)일 때는 설명 칩으로 대체 — 빈 "—"은 원인을
                    // 숨긴다. 계산 변경 없음, 표시 전용.
                    // 2026-10-16: s5_pnl (ADR-0178 slice 2) 도 동일한 무플로우 원인을 공유한다 — year-0
                    // 투자도 계획 capex 에서 오므로 0이면 마찬가지로 부호 변화가 없다.
                    const nb = note.basis ?? "";
                    const irrNoFlowChip = irrV == null && (nb.startsWith("s5_plan") || nb === "s5_pnl") && data?.s5_plan_capex_zero === true;
                    const deltaP50 = c.variant === "historical" && newestMfP50 !== null && p50 ? p50.npv_krw_m - newestMfP50 : null;
                    const deltaPct = deltaP50 !== null && newestMfP50 ? deltaP50 / newestMfP50 : null;
                    // 큰 중앙값 차이는 계산 버그가 아니라 설계된 교차검증 신호다 — 공통 exit 배수 아래에서
                    // 성장 가정 차이(시장 기반 대비)가 값 격차를 지배한다. 설명 탭(ValuationMethodology)으로 안내.
                    const mfNote = c.variant === "historical"
                      ? parseNote(cases.find((m) => m.variant === "market_forward")?.simulations.find((x) => x.percentile === "p50")?.note)
                      : null;
                    const growthGapPp = mfNote?.growth && note.growth
                      ? (Number(note.growth) - Number(mfNote.growth)) * 100
                      : null;
                    return (
                      <tr key={c.id}>
                        <td>
                          {c.variant === "market_forward" ? <span className="status-chip status-green">1차</span> : <span className="status-chip status-amber">비교</span>}{" "}
                          <b>{VARIANT_LABEL[c.variant]}</b>
                          {c.adopted && <span className="status-chip status-green ml-1" title={`채택자 ${data?.adoption?.adoptedBy ?? ""}`}>채택됨</span>}
                        </td>
                        <td>
                          {note.growth ? `${(Number(note.growth) * 100).toFixed(1)}%` : "—"}
                          <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] cell-clamp-3"> {note.growth_source ?? ""}</span>
                          {c.variant === "historical" && note.growth && escalatedCagrPct !== null && Math.abs(Number(note.growth) * 100 - escalatedCagrPct) > 15 && (
                            <span
                              className="status-chip status-amber mt-1 block w-fit max-w-full whitespace-normal [overflow-wrap:anywhere]"
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
                          return <td key={p} className="num mono-num">{sim ? fmtNpvKrwM(sim.npv_krw_m) : "—"}</td>;
                        })}
                        <td className="num" data-testid="scenario-irr-cell">
                          {irrV != null ? `${(irrV * 100).toFixed(1)}%` : irrNoFlowChip ? (
                            <span
                              data-testid="irr-no-flow-chip"
                              className="status-chip status-amber whitespace-normal [overflow-wrap:anywhere]"
                              title="회수 기간(BEP) 0.0년도 같은 이유입니다. S5 투자비 탭에서 capex 줄을 입력하면 계산됩니다."
                            >
                              투자 플로우 없음 — S5 계획에 설비투자(capex) 줄이 없습니다
                            </span>
                          ) : "—"}
                        </td>
                        {!greenfield && <td className="num">
                          {deltaP50 === null ? "—" : (
                            <span className={deltaP50 >= 0 ? "text-[color:var(--success)] font-bold" : "text-[color:var(--red-fg)] font-bold"}>
                              {deltaP50 >= 0 ? "+" : ""}{fmtNpvKrwM(deltaP50)}{deltaPct !== null ? ` (${deltaPct >= 0 ? "+" : ""}${(deltaPct * 100).toFixed(1)}%)` : ""}
                            </span>
                          )}
                          {c.variant === "historical" && deltaPct !== null && Math.abs(deltaPct) > P50_GAP_WARN_RATIO && (
                            <span role="note" data-testid="p50-gap-hint" className="mt-1 block w-fit max-w-full whitespace-normal [overflow-wrap:anywhere] text-[length:var(--fs-caption)] font-normal text-[color:var(--muted-fg)]">
                              성장 가정 차이가 지배적{growthGapPp !== null ? ` (시장 기반 대비 성장률 ${growthGapPp >= 0 ? "+" : ""}${growthGapPp.toFixed(1)}%p)` : ""}{" "}
                              <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("overview")}>설명: 개요 탭 →</button>
                            </span>
                          )}
                        </td>}
                        {!greenfield && <td className="num mono-num">
                          {note.xcheck_fade_npv ? (
                            <span title={`페이드 DCF 교차검증 — 명시적 ${note.xcheck_horizon ?? "?"}년 창구, 성장률 → ${(Number(note.xcheck_terminal_growth ?? "0") * 100).toFixed(1)}% 선형 수렴, 동일 배수 처분 · IRR ${note.xcheck_fade_irr && note.xcheck_fade_irr !== "null" ? `${(Number(note.xcheck_fade_irr) * 100).toFixed(1)}%` : "—"}`}>
                              {fmtNpvKrwM(Number(note.xcheck_fade_npv))}
                            </span>
                          ) : "—"}
                        </td>}
                        <td className="align-middle">
                          {canAct && (() => {
                            const rowCtx = `${VARIANT_LABEL[c.variant] ?? c.variant} · ${SCEN_LABEL[c.scenario ?? s] ?? c.scenario ?? s}`;
                            return (
                              <div className="flex items-center justify-end gap-1 whitespace-nowrap" data-testid="scenario-row-actions" data-case-id={c.id}>
                                {!c.adopted && (
                                  <button type="button" className="btn-ghost btn-sm whitespace-nowrap font-semibold text-[color:var(--accent)]" disabled={busy} aria-label={`${rowCtx} 채택`} onClick={() => adopt(c.id, c.scenario, c.variant)}>
                                    채택
                                  </button>
                                )}
                                <RowMenu
                                  label={`${rowCtx} 작업`}
                                  items={[
                                    { key: "lines", label: greenfield ? "라인 보기" : "라인 편집", onSelect: () => (greenfield ? startView(c) : startEdit(c)) },
                                    { key: "delete", label: "삭제", danger: true, separatorBefore: true, disabled: busy, onSelect: () => remove(c) },
                                  ]}
                                />
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                  {!hasHistorical && !greenfield && (
                    <tr>
                      <td colSpan={10} className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                        과거 기반 관점 N/A — 대상 회사 연결 + DART 동기화 후 재생성하면 추가됩니다.{" "}
                        <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("financial-analysis")}>재무분석 탭에서 연결 →</button>
                      </td>
                    </tr>
                  )}
                  {!hasHistorical && greenfield && cases.length > 0 && (
                    <tr>
                      <td colSpan={8} className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                        과거 기반 관점은 Green Field에 해당 없습니다 — 대상 회사가 없어 시장 기반 관점만 평가합니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table></div>
            )}
            {/* IA cleanup 2026-10-14: the attainment table lives once, in the goals tab. */}
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">
              <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("goals")}>목표 달성 판정은 사업 목표 탭 →</button>
            </p>
            {(cases[0]?.simulations?.[0]?.note) && (
              <details className="raw-key-details mt-1" title="재현 근거 (동일 시드로 재계산해도 같은 결과)">
                <summary>계산 파라미터(원문)</summary> {/* INTERIM-WORDING */}
                <code lang="en" className="block mono-num text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] whitespace-pre-wrap [overflow-wrap:anywhere] select-all">{cases[0].simulations[0].note}</code>
              </details>
            )}
            <p className="text-[length:var(--fs-caption)] text-[var(--muted-fg)] mt-1">
              {greenfield ? "계산 사슬" : "계산 사슬과 두 관점 차이"}: <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("overview")}>설명: 개요 탭 →</button>
            </p>
          </section>
        );
      })}
      </>
      )}

      {data && data.cases.length === 0 && (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">등록된 Business Case가 없습니다 — 자동 생성을 실행하거나 수동으로 추가하세요.</p>
      )}

      {/* ADR-0178: Green Field 라인 읽기 전용 보기 — S5 단일 원본 안내 + S5 투자비 탭 링크. */}
      {viewing && (
        <section
          ref={viewingSectionRef}
          className="market-section sizing-step mt-3 scroll-mt-20"
          aria-label="투자 라인 (읽기 전용)"
          data-testid="s8-lines-readonly"
        >
          <h3 className="sizing-step-title text-[0.9rem]">투자 라인 (읽기 전용)</h3>
          <p className="text-[length:var(--fs-caption)] mb-1" data-testid="s8-lines-readonly-caption">
            <span className="status-chip status-not-started mr-1">S5 단일 원본</span>{" "}
            편집 대상: <b>{viewing.label}</b> —{" "}
            {sourceOppId ? (
              <Link href={`/deals/${encodeURIComponent(sourceOppId)}/s5?tab=investment`} className="text-[color:var(--accent)] font-bold">
                S5 투자비 탭에서 관리
              </Link>
            ) : (
              <span className="text-[color:var(--muted-fg)]">S5 투자비 탭에서 관리</span>
            )}
            .{" "}
            <span className="text-[color:var(--muted-fg)]">S5가 단일 원본입니다 — 투자비 항목은 S5 투자비 탭에서 관리됩니다.</span>
          </p>
          {pinStale && (
            <p
              className="status-chip status-amber block mt-1 w-fit max-w-full whitespace-normal [overflow-wrap:anywhere]"
              data-testid="s8-lines-readonly-stale"
              role="note"
            >
              <span aria-hidden="true">⏱</span> 고정 참조가 재평가 필요 상태입니다 — S5 연결 블록의 `최신 S5로 갱신`으로 갱신 후 `자동 생성`을 다시 실행하세요.{" "}
              <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("overview")}>S5 연결 블록으로 →</button>
            </p>
          )}
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table" data-testid="s8-lines-readonly-table">
              <thead>
                <tr>
                  <th scope="col">분류</th>
                  <th scope="col">항목명</th>
                  <th scope="col" className="num">연간 금액 (백만원)</th>
                  <th scope="col" className="num">시작 연도</th>
                  <th scope="col" className="num">성장률</th>
                  <th scope="col">비고</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l) => (
                  <tr key={l.id} data-testid="s8-lines-readonly-row">
                    <td>{LINE_CATEGORY_LABEL[l.category] ?? l.category}</td>
                    <td>{l.name}</td>
                    <td className="num mono-num">{fmt(l.annual_amount_krw_m)}</td>
                    <td className="num">{l.start_year}</td>
                    <td className="num">{l.growth_rate ? pct1(l.growth_rate) : "—"}</td>
                    <td className="cell-clamp-3">{l.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">
            S8에서는 이 라인을 편집할 수 없습니다 — 편집은 S5 투자비 탭에서, 계산 반영은 `자동 생성`으로 이루어집니다.
          </p>
        </section>
      )}

      {editing && (
        <section ref={editorSectionRef} className="market-section sizing-step mt-3 scroll-mt-20" aria-label="라인 편집">
          <h3 className="sizing-step-title text-[0.9rem]">라인 편집 (JSON — 저장 시 전체 교체)</h3>
          <p className="text-[length:var(--fs-caption)] mb-1" data-testid="line-editor-caption">편집 대상: <b>{editing.label}</b></p>
          <p className="sr-only" role="status" aria-live="polite">라인 편집기가 아래에 열렸습니다 — {editing.label}</p>
          <textarea
            ref={editorTextRef}
            aria-label={`라인 JSON — ${editing.label}`}
            className="sizing-new-input w-full font-mono text-[length:var(--fs-caption)]"
            rows={10}
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            spellCheck={false}
          />
          <div className="flex gap-1 mt-1">
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void saveEdit()}>저장</button>
            <button type="button" className="btn-ghost btn-sm" onClick={closeEditor}>취소</button>
          </div>
        </section>
      )}

      {/* ── 결정 탭: fs 게이트 진행 근거(대상 점검) → 게이트 결정 — IA cleanup 2026-10-14 ── */}
      {tab === "decision" && (
        <div className="mt-4">
          <S8LensStrip projectId={projectId} />
          <TargetCheckPanel projectId={projectId} />
          <AiJudgementSupport
            projectId={projectId}
            gate="fs"
            cases={data?.cases ?? []}
            canAct={canAct}
            onApplyRationale={(text) => setRationalePrefill((p) => ({ text, nonce: (p?.nonce ?? 0) + 1 }))}
          />
          <GateDecisionPanel
            opportunityId={projectId}
            gates={["fs"]}
            entityType="project"
            showReview={false}
            hideBrief
            rationalePrefill={rationalePrefill}
            nextStage={{ label: "S9 실사·검증", href: `/projects/${projectId}/dd` }}
          />
        </div>
      )}
      </StageFrame>
      {confirmDialog}
      {ackFor && (
        <GoalPromptDialog
          title="목표 비교 없이 채택" // INTERIM-WORDING
          body="이 프로젝트에는 적용되는 사업 목표가 없거나, 적용되는 목표가 모두 판정 불가·수동 확인뿐이라 자동 비교가 되지 않습니다. 목표 비교 없이 케이스를 채택하려면 사유를 반드시 적어야 하며, 확인 내용과 사유는 채택 기록에 남습니다." // INTERIM-WORDING
          confirmLabel="목표 비교 없이 채택"
          textLabel="채택 사유"
          textRequired
          checkLabel="목표와의 자동 비교 없이 채택함을 확인합니다."
          errorText={ackError}
          onConfirm={(note) => void postAdopt(ackFor, { acknowledged: true, note })}
          onClose={() => { setAckFor(null); setAckError(null); }}
        />
      )}
</>
  );
}

