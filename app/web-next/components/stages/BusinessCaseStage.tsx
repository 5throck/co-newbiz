"use client";

// S8 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/business-case 페이지와
// /deals/[id]/s8 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.
// 탭 상태는 독립 페이지에서 URL ?tab= 동기, embedded(deals 탭) 모드에서는 내부 상태로
// 유지한다 — router로 프로젝트 페이지를 건드리지 않는다.

import { TranslatorFn } from "../../i18n/config.ts";
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
// S8 읽기 전용 투자 라인 표 6열 — ColGroup 고정 % (R10 table-sizing).
const S8_LINES_RO_COL_PCT = [16, 24, 16, 12, 12, 20] as const;
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
import { irrGuardBand, IRR_GUARD_CHIP_LABEL, IRR_GUARD_DIAGNOSTIC } from "../../lib/irr-guard.ts";
import type { RatioGuardFlag } from "../../lib/share-guard.ts";
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
import { BepAnalysisPanel } from "./BepAnalysisPanel.tsx";
import { RowMenu, useConfirm } from "../crud.tsx";
import { canWriteProject, isReadOnlyAdmin } from "../../lib/project-write-access.ts";
import { countLegacyUnassignedModels, hideHistoricalForGreenfield } from "../../lib/business-case-legacy.ts";
import { GoalPromptDialog, GoalsPanel, type GoalsData } from "../business-case/GoalsPanel.tsx";
import { GOALS_ACK_REQUIRED_CODE, goalsAckErrorText, goalsLoadErrorText, partOfS8Tab, primaryKeyOfS8Tab, resolveS8Tab, shouldRedirectTargetsTab, type CaseAttainmentEntry } from "../../lib/business-goals-view.ts";
import { GoalAttainmentTable } from "../business-case/GoalAttainment.tsx";
import { useTranslations } from "next-intl";

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
  /** ADR-0159: per-case goal attainment keyed by case id (comment-only
   *  interface additions; display/evidence only, never a block). */
  goal_attainment?: Record<string, CaseAttainmentEntry[]>;
  goal_count?: number;
  /** ADR-0179 slice 3 — Y1 revenue vs plan-investment ratio guard (additive,
   *  live, display only). */
  plausibility?: RatioGuardFlag | null;
}
interface ActivityRow {
  activityId: string;
  agentKey: string;
  status: string;
  outputMd: string | null;
}

const SCENARIOS = ["base", "upside", "downside"] as const;
const SCEN_LABEL = (tr: TranslatorFn): Record<string, string> => ({ base: "stages.s8.stage.base", upside: "stages.s8.stage.upside", downside: "stages.s8.stage.downside" });
const ENGINE_LABEL = (tr: TranslatorFn): Record<string, string> => ({ "python-sim-engine": "stages.s8.stage.pythonEngine", "ts-fallback": "stages.s8.stage.tsFallbackEngine", mixed: "stages.s8.stage.mixed" });
const VARIANT_LABEL = (tr: TranslatorFn): Record<string, string> => ({ market_forward: "common.marketBasis", historical: "stages.s8.stage.item" });
// 라인 읽기 전용 표의 분류 표기 (라인 category는 5종 — labor/opex/capex/revenue/gov_rnd).
const LINE_CATEGORY_LABEL = (tr: TranslatorFn): Record<string, string> => ({ labor: "common.laborCost", opex: "common.opex", capex: "common.capex", revenue: "common.revenue", gov_rnd: "stages.s8.stage.governmentRD" });

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

export function BusinessCaseStage({ projectId, embedded }: { projectId: string; embedded?: boolean }) {const tr = useTranslations(); const t = useTranslations("stages.s8.stage"); const tc = useTranslations("common");
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
  // ADR-0179 slice 1 — IRR ceiling guard thresholds (person-settable bc.* params).
  // Display metadata only: the chips annotate the scenario IRR cell, they never
  // block generation, adoption, a gate or a grade.
  const [irrThresholds, setIrrThresholds] = useState<{ flag: number; caution: number } | null>(null);
  useEffect(() => {
    api
      .get<{ params: { irrFlagThreshold?: number; irrCautionThreshold?: number } }>(`/api/projects/${encodeURIComponent(projectId)}/business-case/params`)
      .then((r) => {
        const p = r.data.params;
        if (p && Number.isFinite(p.irrFlagThreshold) && Number.isFinite(p.irrCautionThreshold)) {
          setIrrThresholds({ flag: p.irrFlagThreshold!, caution: p.irrCautionThreshold! });
        }
      })
      .catch(() => setIrrThresholds(null));
  }, [projectId]);
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
      setError(err instanceof Error ? err.message : t("targetSelectionFailed"));
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(() => {
    api.get<CasesResponse>(`/api/projects/${encodeURIComponent(projectId)}/business-case`)
      .then((r) => { setData({ ...r.data, cases: hideHistoricalForGreenfield(r.data.cases, r.data.targets.length === 0) }); setGreenfield(r.data.targets.length === 0); setEscalatedCagrPct(r.data.escalated_cagr_pct ?? null); })
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadBusinessCase")));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const loadGoals = useCallback(() => {
    api.get<GoalsData>(`/api/projects/${encodeURIComponent(projectId)}/business-goals`)
      .then((r) => { setGoalsData(r.data); setGoalsLoadError(null); })
      .catch((e) => { setGoalsData(null); setGoalsLoadError(goalsLoadErrorText(e, t("failedToLoadBusinessGoals"))); }); // INTERIM-WORDING; goals are reference evidence: a failed load never blocks S8
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
      setError(e instanceof Error ? e.message : t("failed"));
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
      else setError(e instanceof Error ? e.message : t("adoptionFailed"));
    } finally {
      setBusy(false);
    }
  }

  function adopt(modelId: string, scenario: string | null, variant: string) {
    confirm(
      t("adoptBusinessCaseP1", { p1: scenario ? ` — ${SCEN_LABEL(tr)[scenario] ?? scenario} · ${VARIANT_LABEL(tr)[variant] ?? variant}` : "" }),
      () => { void postAdopt(modelId); },
      { body: t("adoptsThisCaseAsThe") },
    );
  }

  // ADR-0178: Green Field는 라인을 편집하지 않는다 — 읽기 전용 보기 + S5 투자비 탭 안내.
  // pin 재평가 필요 여부는 params GET의 s5_pin 상태로만 판단(표시 전용).
  function startView(c: CaseView) {
    const label = `${c.target_name ?? tc("noTargetSelected")} · ${c.scenario ? `${SCEN_LABEL(tr)[c.scenario] ?? c.scenario} · ` : ""}${VARIANT_LABEL(tr)[c.variant] ?? c.variant}`;
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
    const label = `${c.target_name ?? tc("noTargetSelected")} · ${c.scenario ? `${SCEN_LABEL(tr)[c.scenario] ?? c.scenario} · ` : ""}${VARIANT_LABEL(tr)[c.variant] ?? c.variant}`;
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
      setError(e instanceof Error ? e.message : t("failedToSaveLinesCheck"));
    } finally {
      setBusy(false);
    }
  }

  function remove(c: CaseView) {
    const modelId = c.id;
    const targetLabel = c.target_name ?? tc("noTargetSelected");
    confirm(
      t("deleteBusinessCaseTargetP1", { p1: targetLabel }),
      () => {
        void (async () => {
          setBusy(true);
          try {
            await api.delete(`/api/projects/${encodeURIComponent(projectId)}/business-case?model_id=${encodeURIComponent(modelId)}`);
            load();
          } catch (e) {
            setError(e instanceof Error ? e.message : tc("errors.deleteFailed"));
          } finally {
            setBusy(false);
          }
        })();
      },
      { body: t("deleteBusinessCaseTargetP1P2", { p1: targetLabel, p2: `${c.scenario ? `${SCEN_LABEL(tr)[c.scenario] ?? c.scenario} · ` : ""}${VARIANT_LABEL(tr)[c.variant] ?? c.variant}.` }), confirmLabel: tc("delete") },
    );
  }

  // ADR-0158 — 예전(대상 미지정) 모델 정리: 미참조는 삭제, 참조된 모델(채택·게이트 근거)은 보관.
  function cleanupLegacy(models: LegacyModelRow[], all: boolean) {
    const toArchive = models.filter((m) => m.referenced).length;
    const toDelete = models.length - toArchive;
    confirm(
      all ? t("cleanUpP1LegacyModel", { p1: models.length }) : t("cleanUpLegacyModelsP1", { p1: models[0]?.name ?? "" }),
      () => {
        void (async () => {
          setBusy(true); setError(null);
          try {
            await api.post(`/api/projects/${encodeURIComponent(projectId)}/business-case/legacy-cleanup`, { model_ids: models.map((m) => m.id) });
            load();
          } catch (e) {
            setError(e instanceof Error ? e.message : t("failedToCleanUpLegacy"));
          } finally {
            setBusy(false);
          }
        })();
      },
      { body: t("unreferencedP1CaseSAre", { p1: toDelete, p2: toArchive }), confirmLabel: t("organize") },
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
    () => SCENARIOS.flatMap((s) => (byScenario.get(s) ?? []).map((c) => ({ id: c.id, header: `${SCEN_LABEL(tr)[s]} · ${VARIANT_LABEL(tr)[c.variant]}` }))),
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
      {/* 리뷰 2026-10-22 (사용자 리포트): StageTabs는 레일 슬롯으로 — h1·스트립이 탭 행
          아래로 밀리지 않고 S1~S7 딜 화면과 같은 머리 위치를 유지한다. */}
      <StageFrame
        stageId="S8"
        heading={greenfield ? t("s8BusinessCaseValuation") : t("s8BusinessCaseValuationComparison")}
        railSlot={<StageTabs projectId={projectId} />}
      >
        {/* The jump chip is the 결정 tab's shortcut — hidden when already there (IA cleanup 2026-10-14). */}
        {tab !== "decision" && <GateDecisionJump gate="fs" beforeJump={() => setTab("decision")} />}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
        {greenfield ? (
          <>{t("perScenario")} <b>{t("marketBasisJudgement")}</b> {t("perspectiveGrowthComesFromMarket")}</>
        ) : (
          <>{t("theSameScenario")} <b>{t("marketBasisJudgement2")}</b>{t("and")} <b>{t("comparisonEvidence")}</b> {t("evaluatesBothPerspectivesSeparatelyAnd")}</>
        )}
        <span className="ml-2 status-chip status-not-started">{t("engineRecommendationIsNotAdoption")}</span>
      </p>

      {readOnlyAdmin && (
        <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
          <span className="status-chip status-not-started mr-1">{tc("readOnly")}</span>
          {t("theAdminRoleCannotChange")}
        </p>
      )}

      {/* R2-E — ADR-0143 이전 대상 미지정 모델 고지. 경고 토큰 + 텍스트(색만이 아님),
          재생성 액션이 1차 액션. 기존 모델은 절대 자동 삭제·이전하지 않는다. */}
      {legacyUnassignedCount > 0 && (
        <div className="legacy-model-notice" role="status">
          <span className="status-chip status-amber" aria-hidden="true">{t("caution")}</span>
          <p className="legacy-model-notice-text">
            {t("createdBefore")} <b>{t("modelWithoutATarget")} {legacyUnassignedCount}{tc("countUnit")}</b>{t("analysisNeedsRegenerationTheyAre")}
          </p>
          {canAct && (
            <button type="button" className="btn-premium btn-sm" disabled={busy} onClick={() => void generate(true)}>
              {busy ? tc("regenerating") : t("regeneratePerTarget")}
            </button>
          )}
          {legacyModels.length > 0 && (
            <div className="legacy-model-list">
              <table className="data-table" aria-label={t("legacyModelList")}>
                <caption className="sr-only">{t("legacyModelWithoutATarget")}</caption>
                <thead>
                  <tr><th scope="col">{t("model")}</th><th scope="col">{t("scenarioAndPerspective")}</th><th scope="col">{t("created")}</th><th scope="col">{t("reference")}</th>{canAct && <th scope="col">{t("organize2")}</th>}</tr>
                </thead>
                <tbody>
                  {legacyModels.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{m.scenario ? `${SCEN_LABEL(tr)[m.scenario] ?? m.scenario} · ` : ""}{VARIANT_LABEL(tr)[m.variant] ?? m.variant}</td>
                      <td className="tabular-nums">{m.created_at.slice(0, 10)}</td>
                      <td>{m.referenced ? <span className="status-chip status-amber">{t("referencedArchived")}</span> : <span className="status-chip status-not-started">{t("unreferencedDelete")}</span>}</td>
                      {canAct && (
                        <td>
                          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => cleanupLegacy([m], false)} aria-label={t("cleanUpLegacyModelsP12", { p1: m.name })}>
                            {t("cleanUpLegacyModels")}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {canAct && (
                <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => cleanupLegacy(legacyModels, true)}>
                  {t("cleanUpLegacyModelsAll")} {legacyModels.length}{tc("countSuffixParen")}
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
        label={t("s8BusinessCaseScreen")}
        active={primaryKeyOfS8Tab(tab) ?? tab}
        onSelect={(k) => setTab(k === "financial" ? "overview" : k)}
        tabs={[
          { key: "goals", label: t("businessGoals") }, // INTERIM-WORDING
          { key: "technical", label: t("technicalFeasibility") }, // INTERIM-WORDING
          { key: "financial", label: t("financialFeasibility") }, // INTERIM-WORDING
          ...(targets.length > 0 ? [{ key: "targets", label: t("targetComparisonAndSelection") }] : []),
          { key: "decision", label: tc("decision") },
        ]}
      />
      {partOfS8Tab(tab) === "financial" && (
        <TabNav
          className="mb-3"
          label={t("financialFeasibility2")}
          active={tab}
          onSelect={setTab}
          tabs={[
            { key: "overview", label: t("explanationGenerationRecommendation") },
            { key: "scenarios", label: t("scenarioComparison") },
            { key: "wacc", label: "WACC" },
            { key: "financial-analysis", label: t("targetCompany") },
            { key: "bep", label: t("financialAnalysis") },
            { key: "params", label: t("parametersAndSnapshot") },
            { key: "target-costing", label: t("targetCosting") },
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
      {tab === "bep" && <BepAnalysisPanel projectId={projectId} />}

      {/* ── ADR-0143 대상 비교·선정 (brownfield) — 권고 ≠ 선정, 선정은 사람 ── */}
      {tab === "targets" && targets.length === 0 && (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)] mb-3" role="note">
          {t("thisProjectHasNoTarget")}
        </p>
      )}
      {tab === "targets" && targets.length > 0 && (
      <section className="market-section sizing-step mb-3" aria-label={t("compareAndSelectAmongShortlist")}>
        <h3 className="sizing-step-title">{t("compareAndSelectAmongShortlist2")} <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("allShortlistTargets")}</span><DevRef refs="flow.spec S8 subjectScope: shortlist · ADR-0143" /></h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          {t("comparesEachTargetSLatest")}
        </p>
        {selectedTargetName && (
          <p className="text-[length:var(--fs-caption)] mb-2">
            <span className="status-chip status-green">{t("selected")}</span> <b>{selectedTargetName}</b> {t("evidence")} {data?.target_selection?.rationale}{" "}
            <span className="text-[color:var(--muted-fg)]">({data?.target_selection?.selectedBy})</span>
          </p>
        )}
        <div className="mb-2 grid gap-1" aria-label={t("evRevenueBandStatus")}>
          {evBand?.confirmed ? (
            <p className="text-[length:var(--fs-caption)]" role="note">
              <span className="status-chip status-green mr-1"><span aria-hidden="true">✓</span> {t("band")}</span>
              <b className="mono-num">{evBand.confirmed.min}–{evBand.confirmed.max}×</b> {t("evidence2")} {evBand.confirmed.rationale} {t("source")} {evBand.confirmed.source}{" "}
              <span className="text-[color:var(--muted-fg)]">{t("confirmed")} {evBand.confirmed.confirmedBy}, {evBand.confirmed.confirmedAt})</span>
              <span className="text-[color:var(--muted-fg)]"> {t("referenceGlobal")} {refBand.min}–{refBand.max}{t("noEvidenceInThisArea")}</span>
            </p>
          ) : (
            <p className="text-[length:var(--fs-caption)]" role="note">
              <span className="status-chip status-not-started mr-1"><span aria-hidden="true">ⓘ</span> {t("bandNotConfirmed")}</span>
              {t("noInJudgementIsShown")} {refBand.min}–{refBand.max}{t("noEvidenceInThisArea2")}
            </p>
          )}
          {evBand?.spreadFlag && evBand.confirmed && (
            <p className="status-chip status-amber" role="note">
              <span aria-hidden="true">⚠</span> {t("theConfirmedBandIsWide")} {(evBand.confirmed.max / evBand.confirmed.min).toFixed(1)}{t("x45xCheckThe")}
            </p>
          )}
          {evBand?.stale && evBand.confirmed && (
            <p className="status-chip status-amber" role="note">
              <span aria-hidden="true">⏱</span> {t("neededAfterConfirmation")} {evBand.ageDays}{t("daysElapsedConfirmed")} {evBand.confirmed.confirmedAt}{t("advisoryOnlyItDoesNot")}
            </p>
          )}
          {evBand?.confirmed && data?.methods_mixed && (
            <p className="status-chip status-amber" role="note">
              <span aria-hidden="true">⚠</span> {t("targetsWithDifferentEvaluationBases")}
            </p>
          )}
          {evBand?.confirmed && data?.target_selection && data.target_selection.selectedBy === evBand.confirmed.confirmedBy && (
            <p className="status-chip status-amber" role="note">
              <span aria-hidden="true">⚠</span> {t("thePersonConfirmingTheBand")}{evBand.confirmed.confirmedBy}{t("aSecondReviewerSConfirmation")}
            </p>
          )}
          {evBand?.optimismFlag && evBand.confirmed && (
            <p className="status-chip status-amber" role="note">
              <span aria-hidden="true">⚠</span> {t("confirmedUpperBound")} {evBand.confirmed.max}{t("xExceedsTheGlobalReference")}{refBand.max}{t("checkForOptimisticBiasWarning")}
            </p>
          )}
        </div>
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table table-fixed-pct tmin-80" aria-label={t("targetComparison")}>
          <caption className="sr-only">{t("targetComparisonS7RankNpv")}</caption>
          <ColGroup widths={CASE_COMPARE_COL_PCT} />
          <thead>
            <tr>
              <th scope="col">{t("target")}</th>
              <th scope="col" className="num">{t("s7Rank")}</th>
              <th scope="col" className="num">{t("baseNpvBottom")}<UnitNote /></th>
              <th scope="col" className="num">{t("baseNpvMedian")}<UnitNote /></th>
              <th scope="col" className="num">IRR (%)</th>
              <th scope="col" className="num">{t("case")}</th>
              <th scope="col">{t("calculationEngine")}</th>
              <th scope="col" title={t("howFarTheFadedDcf")}>{t("structure")}<span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-normal block">{t("fadedDcfVsMedian")}</span></th>
              <th scope="col" title={t("theGeneratorAppliesTheSame")}>{t("assumedEvRevenueMultipleEntry")}</th>
              <th scope="col" title={t("whichRevenueBasisThisTarget")}>{t("evaluationCriteria")}</th>
              <th scope="col" className="min-w-[calc(var(--space-8)*3)]"><span className="sr-only">{tc("actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {targets.map((tgt) => {
              const isSelected = data?.target_selection?.targetId === tgt.targetId;
              return (
                <tr key={tgt.targetId}>
                  <td>
                    <b>{tgt.companyName}</b>
                    {tgt.recommended && <span className="status-chip status-green ml-1" title={t("quantitativeMethodologyRecommendationBottomSurvival")}>{t("recommendation")}</span>}
                    {isSelected && <span className="status-chip status-green ml-1">{t("selected2")}</span>}
                  </td>
                  <td className="num">{tgt.rank ?? "—"}</td>
                  <td className="num mono-num">{tgt.baseP05 !== null ? fmtNpvKrwM(tgt.baseP05) : "—"}</td>
                  <td className="num mono-num">{tgt.baseP50 !== null ? fmtNpvKrwM(tgt.baseP50) : "—"}</td>
                  <td className="num mono-num">{tgt.irr != null ? `${(tgt.irr * 100).toFixed(1)}%` : "—"}</td>
                  <td className="num">{tgt.caseCount}</td>
                  <td><span className="status-chip status-not-started whitespace-nowrap">{ENGINE_LABEL(tr)[tgt.engine ?? ""] ?? t("engineNotRecorded")}</span></td>
                  <td className="num min-w-[calc(var(--space-8)*5)]">
                    {tgt.xcheckDivergence != null ? (
                      <>
                        <span className="mono-num">{tgt.xcheckDivergence >= 0 ? "+" : "−"}{Math.abs(tgt.xcheckDivergence * 100).toFixed(1)}%</span>
                        {tgt.xcheckFadeNpv != null && tgt.baseP50 != null && (
                          <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] block">
                            {t("difference")} {tgt.xcheckFadeNpv - tgt.baseP50 >= 0 ? "+" : "−"}{fmtNpvKrwM(Math.abs(tgt.xcheckFadeNpv - tgt.baseP50))} {t("fadedNpv")} {fmtNpvKrwM(tgt.xcheckFadeNpv)})
                          </span>
                        )}
                      </>
                    ) : tgt.recommended ? (
                      <span className="status-chip status-amber" title={t("noFadedDcfIsRecorded")}>
                        <span aria-hidden="true">⚠</span> {t("no")}
                      </span>
                    ) : (
                      <span aria-label={t("notApplicableNoRecord")} title={t("noFadedDcfIsRecorded2")}>N/A</span>
                    )}
                    {tgt.structureMismatch && (
                      <span className="status-chip status-amber block mt-1" role="note">
                        <span aria-hidden="true">⚠</span> {t("structureMismatchTheFadedDcf")} {XCHECK_WARN_PCT}{t("apartReviewTheGrowthRate")}
                      </span>
                    )}
                  </td>
                  <td className="num min-w-[calc(var(--space-8)*5)]">
                    {tgt.acqEvRevenue != null ? (
                      <>
                        <span className="mono-num">{tgt.acqEvRevenue.toFixed(1)}×</span>
                        {evBand?.confirmed && tgt.acqEvRevenueInBand != null ? (
                          <span
                            className={`status-chip block mt-1 whitespace-nowrap ${tgt.acqEvRevenueInBand ? "status-not-started" : "status-amber"}`}
                            title={t("referenceMarkerAgainstThePersonConfirmedProjectBandP1P8", { p1: evBand.confirmed.min, p2: evBand.confirmed.max, p3: evBand.confirmed.rationale, p4: evBand.confirmed.source, p5: evBand.confirmed.confirmedBy, p6: evBand.confirmed.confirmedAt, p7: evBand.stale ? t("neededP1DaysSinceConfirmation", { p1: evBand.ageDays ?? "?" }) : "", p8: data?.methods_mixed ? t("bandJudgementsCannotBeCompared") : "" })}
                          >
                            <span aria-hidden="true">{tgt.acqEvRevenueInBand ? "ⓘ" : "⚠"}</span>{" "}
                            {tgt.acqEvRevenueInBand ? t("withinTheConfirmedBandP1", { p1: evBand.confirmed.min, p2: evBand.confirmed.max }) : t("outsideTheConfirmedBandP1", { p1: evBand.confirmed.min, p2: evBand.confirmed.max })}
                            {evBand.stale && <> · <span aria-hidden="true">⏱</span> {t("needed")}</>}
                          </span>
                        ) : (
                          <span
                            className="status-chip status-not-started block mt-1 whitespace-nowrap"
                            aria-label={t("bandNotConfirmedReferenceGlobal", { p1: refBand.min, p2: refBand.max })}
                            title={t("noProjectBandExistsSo")}
                          >
                            <span aria-hidden="true">ⓘ</span> {t("bandNotConfirmed2")}
                          </span>
                        )}
                      </>
                    ) : (
                      <span aria-label={t("notApplicableNoMultiple")} title={t("theCaseWasNotValued")}>N/A</span>
                    )}
                  </td>
                  <td className="min-w-[calc(var(--space-8)*5)]">
                    {tgt.anchorMethod === "company_revenue" && (
                      <span className="status-chip status-green whitespace-nowrap" title={t("valuesTheTargetCompanyS")}>{t("actualAnchorDart")}</span>
                    )}
                    {tgt.anchorMethod === "market_capture" && (
                      <span className="status-chip status-amber whitespace-nowrap" title={t("noCompanyActualsLinkedSo")}>{t("marketShareFallback")}</span>
                    )}
                    {!tgt.anchorMethod && <span className="status-chip status-not-started whitespace-nowrap">{t("notEvaluated")}</span>}
                  </td>
                  <td className="min-w-[calc(var(--space-8)*3)]">
                    {canAct && !isSelected ? (
                      <button type="button" className="btn-ghost btn-sm whitespace-nowrap" disabled={busy} onClick={() => { setSelecting({ targetId: tgt.targetId, name: tgt.companyName }); setSelectionRationale(""); }}>
                        {t("selectTarget")}
                      </button>
                    ) : isSelected ? (
                      // 빈 작업 셀 대신 선정 상태를 남긴다 — 이 행의 액션이 비어 있는
                      // 이유(이미 선정됨)를 표가 설명하게 한다(2026-10 표 인터랙션 리뷰).
                      <span className="status-chip status-green whitespace-nowrap">{t("selected3")}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">
          {t("theStructureAndAssumedEv")}
          {data?.methods_mixed && t("evaluationCriteriaDifferPerTarget")}
        </p>
        {data?.engines_mixed && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">
            {t("theComparedCasesWereProduced")}
          </p>
        )}
        {data?.methods_mixed && (
          <p className="text-[length:var(--fs-caption)] mt-1" role="alert">
            <span className="status-chip status-amber mr-1">{t("evaluationCriteriaMismatch")}</span>
            {t("theComparisonTargetsMixEvaluation")} <b>{t("companyActualsAnchor")}</b>{t("notTheDartAnnualRevenue")} <b>{t("marketShareFallback2")}</b>{t("marketSizeShareSoP05")}
          </p>
        )}
        {targets.every((t) => t.caseCount === 0) && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">{t("noAnalyzedCasesYetRun")}</p>
        )}
        {selecting && (
          <div className="mt-2">
            <p className="text-[length:var(--fs-caption)] mb-1"><b>{selecting.name}</b> {t("targetSelectionEvidenceRequiredBecomes")}</p>
            <textarea
              className="sizing-new-input w-full"
              rows={3}
              value={selectionRationale}
              onChange={(e) => setSelectionRationale(e.target.value)}
              spellCheck={false}
              aria-label={t("targetSelectionEvidence")}
            />
            <div className="flex gap-1 mt-1">
              <button type="button" className="btn-ghost btn-sm" disabled={busy || !selectionRationale.trim()} onClick={() => void submitTargetSelection()}>{t("selectionRecord")}</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSelecting(null)}>{tc("cancel")}</button>
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
            {busy ? tc("creating") : greenfield ? t("marketBasis3Scenarios") : t("marketPastBasis3Scenarios")}
          </button>
          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {busy ? t("calculatingResultsRefreshWhenDone") : t("recordTheDecisionInThe")}
          </span>
        </div>
      )}

      {run && (
        <details className="mb-3">
          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("generationRunLog")}{run.runId} — {run.status})</summary>
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
      <section className="market-section sizing-step mb-3" aria-label={t("whatTheEvaluationPerspectiveMeans")}>
        <h3 className="sizing-step-title">{t("whatTheEvaluationPerspectiveMeans2")}</h3>
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table">
          <caption className="sr-only">{t("whatTheEvaluationPerspectiveMeans3")}</caption>
          <thead><tr><th scope="col">{tc("perspective")}</th><th scope="col">{t("growthRateEvidence")}</th><th scope="col">{t("volatilitySigmaEvidence")}</th><th scope="col">{t("usage")}</th></tr></thead>
          <tbody>
            <tr>
              <td><span className="status-chip status-green">{t("firstPass")}</span> {tc("marketBasis")}</td>
              <td>{tc("marketGrowthOpportunity")}</td>
              <td>{t("futureVolatilityProfileBlendingVolatility")}</td>
              <td>{t("s8CompletionKillCriteriaAnd")}</td>
            </tr>
          </tbody>
        </table></div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
          {t("comparisonAppliesOnlyToBrown")}
        </p>
      </section>
      ) : (
      <>
      {/* 두 관점의 의미 */}
        <section className="market-section sizing-step mb-3" aria-label={t("whatTheTwoPerspectivesMean")}>
          <h3 className="sizing-step-title">{t("whatTheTwoPerspectivesMean2")}</h3>
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table">
            <caption className="sr-only">{t("whatTheTwoPerspectivesMean3")}</caption>
            <thead><tr><th scope="col">{tc("perspective")}</th><th scope="col">{t("growthRateEvidence2")}</th><th scope="col">{t("volatilitySigmaEvidence2")}</th><th scope="col">{t("usage2")}</th></tr></thead>
            <tbody>
              <tr>
                <td><span className="status-chip status-green">{t("firstPass2")}</span> {tc("marketBasis")}</td>
                <td>{tc("marketGrowthOpportunity")}</td>
                <td>{t("futureVolatilityProfileBlendingPast")}</td>
                <td>{t("s8CompletionKillCriteriaAnd2")}</td>
              </tr>
              <tr>
                <td><span className="status-chip status-amber">{t("historicalComparison")}</span> {t("item2")}</td>
                <td>{t("targetCompanyRevenueCagrDart")}</td>
                <td>{t("stdDeviationOfPastRevenue")}</td>
                <td>{t("comparisonEvidenceFromThePerspective")}</td>
              </tr>
            </tbody>
          </table></div>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
            <b className="text-[color:var(--amber-fg)]">{t("progressJudgementsAdoptionRequirementsKill")}</b>{" "}
            {t("theViewIsForComparison")}
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
          {t("theAiAdoptionRecommendationIs")}{" "}
          <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("decision")}>{t("decisionTab")}</button>
        </p>
      )}
      </>
      )}

      {/* 시나리오별 이중 관점 비교 — brownfield는 유효 대상 필터의 케이스만.
          IA cleanup 2026-10-14: capability content lives in the technical tab —
          this is only a pointer (each fact gets ONE home). */}
      {tab === "scenarios" && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-3" role="note">
          <span className="status-chip status-not-started mr-1"><span aria-hidden="true">ⓘ</span> {t("capability")}</span>
          {/* 2026-10-19 decider: Brownfield의 필요 역량 판정 주전장은 S9 실사·검증(필요 역량 검증 탭) —
              S8 기술 탭은 그 결과를 반영하는 읽기 전용 뷰다. */}
          {!greenfield && targets.length > 0 ? (
            <>
              {t("brownfieldRequiredCapabilityJudgementHappens")}{" "}
              <a href={`/projects/${projectId}/dd`} className="text-[color:var(--accent)] font-bold">{t("requiredCapabilityVerificationTab")}</a>
            </>
          ) : (
            <>
              {t("theCapabilityAttainabilityJudgement")}{" "}
              <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("technical")}>{t("technicalFeasibilityTab")}</button>
            </>
          )}
        </p>
      )}
      {tab === "scenarios" && (
      <>
      {targets.length > 1 && (
        <div className="mt-3 mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("analysisScope")}</span>
          <TargetSelector
            targets={targets.map((t) => ({ targetId: t.targetId, name: t.companyName, companyId: t.targetId, isBound: data?.target_selection?.targetId === t.targetId }))}
            selected={effectiveTargetFilter}
            onSelect={setTargetFilter}
            ariaLabel={t("analysisScopeFilter")}
          />
        </div>
      )}
      {/* W1-19/W2-07: the goals tab owns the 목표 미설정 state — no callout here. */}
      {SCENARIOS.map((s) => {
        const cases = byScenario.get(s) ?? [];
        const newestMf = cases.find((c) => c.variant === "market_forward");
        const newestMfP50 = newestMf?.simulations.find((x) => x.percentile === "p50")?.npv_krw_m ?? null;
        return (
          <section key={s} className="market-section sizing-step mt-3" aria-label={greenfield ? t("p1Valuation", { p1: SCEN_LABEL(tr)[s] }) : t("p1Comparison", { p1: SCEN_LABEL(tr)[s] })}>
            <h3 className="sizing-step-title">
              {SCEN_LABEL(tr)[s]}
              {newestMf?.recommended && <span className="status-chip status-green ml-1" title={t("quantitativeMethodologyRecommendationBottomSurvival2")}>{t("recommendation2")}</span>}
              {newestMf?.adopted && <span className="status-chip status-green ml-1">{t("adoptedFsProgressInput")}</span>}
            </h3>
            {cases.length === 0 ? (
              <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">
                {t("noCasesForThisScenario")}
              </p>
            ) : (
              <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table table-fixed-pct tmin-56">
                <caption className="sr-only">{SCEN_LABEL(tr)[s]} {t("caseComparisonPerspectiveGrowthVolatility")}</caption>
                <ColGroup widths={greenfield ? SCENARIO_CASE_COL_PCT_GF : SCENARIO_CASE_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">{tc("perspective")}</th>
                    <th scope="col">{tc("growthRate")} <span className="text-[color:var(--muted-fg)]">{t("source2")}</span></th>
                    <th scope="col">{t("volatilitySigma")} <span className="text-[color:var(--muted-fg)]">{t("source3")}</span></th>
                    <th scope="col" className="num">{t("npvBottom")}<UnitNote /></th>
                    <th scope="col" className="num">{t("npvMedian")}<UnitNote /></th>
                    <th scope="col" className="num">{t("npvTop")}<UnitNote /></th>
                    <th scope="col" className="num">IRR <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-normal block">(%)</span></th>
                    {!greenfield && <th scope="col" className="num">{t("medianDifference")}<span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] font-normal block">({KRW_MILLIONS_UNIT}{t("vsMarketBasis")}</span></th>}
                    {!greenfield && <th scope="col" className="num" title={t("dualStructureRevaluesTheSame")}>{t("fadedDcfMedian")}<UnitNote /></th>}
                    <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
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
                          {c.variant === "market_forward" ? <span className="status-chip status-green">{t("firstPass3")}</span> : <span className="status-chip status-amber">{t("comparison")}</span>}{" "}
                          <b>{VARIANT_LABEL(tr)[c.variant]}</b>
                          {c.adopted && <span className="status-chip status-green ml-1" title={t("adoptedByP1", { p1: data?.adoption?.adoptedBy ?? "" })}>{t("adopted")}</span>}
                        </td>
                        <td>
                          {note.growth ? `${(Number(note.growth) * 100).toFixed(1)}%` : "—"}
                          <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] cell-clamp-3"> {note.growth_source ?? ""}</span>
                          {c.variant === "historical" && note.growth && escalatedCagrPct !== null && Math.abs(Number(note.growth) * 100 - escalatedCagrPct) > 15 && (
                            <span
                              className="status-chip status-amber mt-1 block w-fit max-w-full whitespace-normal [overflow-wrap:anywhere]"
                              title={t("theGapBetweenTheCagr", { p1: escalatedCagrPct.toFixed(1) })}
                            >
                              {t("theAdjustmentAnd")} {(Number(note.growth) * 100 - escalatedCagrPct).toFixed(1)}{t("difference2")}
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
                          {(() => {
                            const band = irrGuardBand(irrV, irrThresholds?.flag, irrThresholds?.caution);
                            if (irrV != null) {
                              return (
                                <>
                                  {(irrV * 100).toFixed(1)}%
                                  {band && (
                                    <>
                                      <span
                                        data-testid={`irr-guard-chip-${band}`}
                                        className="status-chip status-amber mt-1 block w-fit max-w-full whitespace-normal [overflow-wrap:anywhere]"
                                        title={IRR_GUARD_DIAGNOSTIC}
                                      >
                                        {IRR_GUARD_CHIP_LABEL[band]} {t("base2")} {irrThresholds ? `${(irrThresholds[band === "extreme" ? "flag" : "caution"] * 100).toFixed(0)}%` : band === "extreme" ? "100%" : "50%"})
                                      </span>
                                    </>
                                  )}
                                </>
                              );
                            }
                            if (irrNoFlowChip) {
                              return (
                                <span
                                  data-testid="irr-no-flow-chip"
                                  className="status-chip status-amber whitespace-normal [overflow-wrap:anywhere]"
                                  title={t("thatIsWhyThePayback")}
                                >
                                  {t("noInvestmentFlowsTheS5")}
                                </span>
                              );
                            }
                            return "—";
                          })()}
                        </td>

                        {!greenfield && <td className="num">
                          {deltaP50 === null ? "—" : (
                            <span className={deltaP50 >= 0 ? "text-[color:var(--success)] font-bold" : "text-[color:var(--red-fg)] font-bold"}>
                              {deltaP50 >= 0 ? "+" : ""}{fmtNpvKrwM(deltaP50)}{deltaPct !== null ? ` (${deltaPct >= 0 ? "+" : ""}${(deltaPct * 100).toFixed(1)}%)` : ""}
                            </span>
                          )}
                          {c.variant === "historical" && deltaPct !== null && Math.abs(deltaPct) > P50_GAP_WARN_RATIO && (
                            <span role="note" data-testid="p50-gap-hint" className="mt-1 block w-fit max-w-full whitespace-normal [overflow-wrap:anywhere] text-[length:var(--fs-caption)] font-normal text-[color:var(--muted-fg)]">
                              {t("theGrowthAssumptionDifferenceDominates")}{growthGapPp !== null ? t("growthP1P2VsMarket", { p1: growthGapPp >= 0 ? "+" : "", p2: growthGapPp.toFixed(1) }) : ""}{" "}
                              <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("overview")}>{t("seeTheOverviewTab")}</button>
                            </span>
                          )}
                        </td>}
                        {!greenfield && <td className="num mono-num">
                          {note.xcheck_fade_npv ? (
                            <span title={t("fadedDcfExplicitP1Window", { p1: note.xcheck_horizon ?? "?", p2: (Number(note.xcheck_terminal_growth ?? "0") * 100).toFixed(1), p3: note.xcheck_fade_irr && note.xcheck_fade_irr !== "null" ? `${(Number(note.xcheck_fade_irr) * 100).toFixed(1)}%` : "—" })}>
                              {fmtNpvKrwM(Number(note.xcheck_fade_npv))}
                            </span>
                          ) : "—"}
                        </td>}
                        <td className="align-middle">
                          {canAct && (() => {
                            const rowCtx = `${VARIANT_LABEL(tr)[c.variant] ?? c.variant} · ${SCEN_LABEL(tr)[c.scenario ?? s] ?? c.scenario ?? s}`;
                            return (
                              <div className="flex items-center justify-end gap-1 whitespace-nowrap" data-testid="scenario-row-actions" data-case-id={c.id}>
                                {!c.adopted && (
                                  <button type="button" className="btn-ghost btn-sm whitespace-nowrap font-semibold text-[color:var(--accent)]" disabled={busy} aria-label={t("p1Adopt", { p1: rowCtx })} onClick={() => adopt(c.id, c.scenario, c.variant)}>
                                    {t("adopt")}
                                  </button>
                                )}
                                <RowMenu
                                  label={t("p1WorkOn", { p1: rowCtx })}
                                  items={[
                                    { key: "lines", label: greenfield ? t("viewLines") : t("editLine"), onSelect: () => (greenfield ? startView(c) : startEdit(c)) },
                                    { key: "delete", label: tc("delete"), danger: true, separatorBefore: true, disabled: busy, onSelect: () => remove(c) },
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
                        {t("perspectiveNAItAppears")}{" "}
                        <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("financial-analysis")}>{t("linkInTheFinancialAnalysis")}</button>
                      </td>
                    </tr>
                  )}
                  {!hasHistorical && greenfield && cases.length > 0 && (
                    <tr>
                      <td colSpan={8} className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                        {t("thePerspectiveDoesNotApply")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table></div>
            )}
            {/* ADR-0179 slice 3 — Y1 revenue vs plan-investment ratio guard. Case-level
                display warning recomputed live on read; says "check the anchor",
                never "the case is wrong"; never blocks. Diagnostic pointer style
                consistent with the IRR guard. */}
            {data?.plausibility?.tripped && (
              <div role="status" data-testid="ratio-guard-warning" className="mt-2 p-3 border border-[color:var(--border)] rounded-[length:var(--radius)]">
                <span className="status-chip status-amber">
                  {data.plausibility.label} {t("revenue")} {fmtNpvKrwM(data.plausibility.y1_revenue_krw_m!)} {t("investment")} {fmtNpvKrwM(data.plausibility.investment_krw_m!)} = {data.plausibility.ratio?.toFixed(1)}{t("xBase")} {data.plausibility.threshold}{t("xOrMore")}
                </span>{" "}
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{data.plausibility.diagnostic}</span>
              </div>
            )}
            {/* IA cleanup 2026-10-14: the attainment table lives once, in the goals tab. */}
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">
              <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("goals")}>{t("goalAttainmentJudgementIsIn")}</button>
            </p>
            {(cases[0]?.simulations?.[0]?.note) && (
              <details className="raw-key-details mt-1" title={t("reproducibilityEvidenceSameSeedAlways")}>
                <summary>{t("calculationParametersOriginal")}</summary> {/* INTERIM-WORDING */}
                <code lang="en" className="block mono-num text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] whitespace-pre-wrap [overflow-wrap:anywhere] select-all">{cases[0].simulations[0].note}</code>
              </details>
            )}
            <p className="text-[length:var(--fs-caption)] text-[var(--muted-fg)] mt-1">
              {greenfield ? t("calculationChain") : t("calculationChainAndTheDifference")}: <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("overview")}>{t("seeTheOverviewTab2")}</button>
            </p>
          </section>
        );
      })}
      </>
      )}

      {data && data.cases.length === 0 && (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("noBusinessCaseRegisteredRun")}</p>
      )}

      {/* ADR-0178: Green Field 라인 읽기 전용 보기 — S5 단일 원본 안내 + S5 투자비 탭 링크. */}
      {viewing && (
        <section
          ref={viewingSectionRef}
          className="market-section sizing-step mt-3 scroll-mt-20"
          aria-label={t("investmentLines")}
          data-testid="s8-lines-readonly"
        >
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("investmentLines2")}</h3>
          <p className="text-[length:var(--fs-caption)] mb-1" data-testid="s8-lines-readonly-caption">
            <span className="status-chip status-not-started mr-1">{t("s5SingleSourceOfTruth")}</span>{" "}
            {t("editing")} <b>{viewing.label}</b> —{" "}
            {sourceOppId ? (
              <Link href={`/deals/${encodeURIComponent(sourceOppId)}/s5?tab=investment`} className="text-[color:var(--accent)] font-bold">
                {t("managedInTheS5Investment")}
              </Link>
            ) : (
              <span className="text-[color:var(--muted-fg)]">{t("managedInTheS5Investment2")}</span>
            )}
            .{" "}
            <span className="text-[color:var(--muted-fg)]">{t("s5IsTheSingleSource")}</span>
          </p>
          {pinStale && (
            <p
              className="status-chip status-amber block mt-1 w-fit max-w-full whitespace-normal [overflow-wrap:anywhere]"
              data-testid="s8-lines-readonly-stale"
              role="note"
            >
              <span aria-hidden="true">⏱</span> {t("theFixedReferenceNeedsRefresh")}{" "}
              <button type="button" className="text-[color:var(--accent)] font-bold" onClick={() => setTab("overview")}>{t("toTheS5LinkBlock")}</button>
            </p>
          )}
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-56" data-testid="s8-lines-readonly-table">
              <caption className="sr-only">{t("investmentLinesClassificationItemName")}</caption>
              <ColGroup widths={S8_LINES_RO_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">{tc("classification")}</th>
                  <th scope="col">{tc("itemName")}</th>
                  <th scope="col" className="num">{t("annualAmountKrwMillions")}</th>
                  <th scope="col" className="num">{t("startYear")}</th>
                  <th scope="col" className="num">{tc("growthRate")}</th>
                  <th scope="col">{tc("notes")}</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l) => (
                  <tr key={l.id} data-testid="s8-lines-readonly-row">
                    <td>{LINE_CATEGORY_LABEL(tr)[l.category] ?? l.category}</td>
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
            {t("thisLineCannotBeEdited")}
          </p>
        </section>
      )}

      {editing && (
        <section ref={editorSectionRef} className="market-section sizing-step mt-3 scroll-mt-20" aria-label={t("editLine2")}>
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("editLinesJsonFullReplace")}</h3>
          <p className="text-[length:var(--fs-caption)] mb-1" data-testid="line-editor-caption">{t("editing2")} <b>{editing.label}</b></p>
          <p className="sr-only" role="status" aria-live="polite">{t("theLineEditorIsOpen")} {editing.label}</p>
          <textarea
            ref={editorTextRef}
            aria-label={t("lineJsonP1", { p1: editing.label })}
            className="sizing-new-input w-full font-mono text-[length:var(--fs-caption)]"
            rows={10}
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            spellCheck={false}
          />
          <div className="flex gap-1 mt-1">
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void saveEdit()}>{tc("save")}</button>
            <button type="button" className="btn-ghost btn-sm" onClick={closeEditor}>{tc("cancel")}</button>
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
            nextStage={{ label: t("s9DueDiligenceAndVerification"), href: `/projects/${projectId}/dd` }}
          />
        </div>
      )}
      </StageFrame>
      {confirmDialog}
      {ackFor && (
        <GoalPromptDialog
          title={t("adoptWithoutTargetComparison")} // INTERIM-WORDING
          body={t("noApplicableBusinessGoalsExist")} // INTERIM-WORDING
          confirmLabel={t("adoptWithoutTargetComparison2")}
          textLabel={t("adoptionReason")}
          textRequired
          checkLabel={t("confirmsAdoptionWithoutAutomaticTarget")}
          errorText={ackError}
          onConfirm={(note) => void postAdopt(ackFor, { acknowledged: true, note })}
          onClose={() => { setAckFor(null); setAckError(null); }}
        />
      )}
</>
  );
}

