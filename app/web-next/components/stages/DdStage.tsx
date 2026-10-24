"use client";

// S9 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/dd 페이지와
// /deals/[id]/s9 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.

import { TranslatorFn } from "../../i18n/config.ts";
import {
  PLAN_READINESS_KEY, PLAN_STATUS_TEXT, codeMeta, countAnnouncement, countLocation, judgedLine, needsNaReason, notCountedNotice, planArtefactHref, planReadinessLabel,
  REPLACED_PENDING_NOTE, pointerText, replacementUndecided, s9Heading, splitItems, statusText, tabCounts, tabLabel, tabStepTags, validateNaReason, workspaceView, type GfScope, type WsItemScope,
} from "../../lib/greenfield-dd-view.ts";
import { GreenfieldScopePanel } from "./GreenfieldScopePanel.tsx";
import { BrownfieldScopePanel } from "./BrownfieldScopePanel.tsx";
import { bfCodeMeta, bfExcludedGroups, bfNeedsNaReason, bfPreviousForTab, bfScopeBlock, isBfExtraTab, type BfScopeBlock } from "../../lib/brownfield-dd-view.ts";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { StageTabs } from "../StageTabs.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { StageFrame } from "../StageFrame.tsx";
import { TabNav } from "../TabNav.tsx";
import { GateDecisionJump, GateDecisionPanel } from "../GateDecisionPanel.tsx";
import { CapabilityDdTab } from "./CapabilityDdTab.tsx";
import { WaiverPanel, WaiverRequestForm } from "../WaiverPanel.tsx";
import { koChecklistText, nonWaivableReason } from "../../lib/dd-checklist-ko.ts";
import { ddItemDisplay, matchesFilter, type ItemFilter } from "../../lib/dd-item-display.ts";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { ColGroup, useToast } from "../ui.tsx";
import { useConfirm } from "../crud.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { ReviewBadgeChip } from "../ReviewBadge.tsx";
import { DRAFT_AI_MARKER, reviewBadge, type ReviewStatus } from "../../lib/checklist-review-status.ts";
import TargetSelector, { type AnalysisTarget } from "../TargetSelector.tsx";
import { useTranslations } from "next-intl";
import { DD_DOMAIN_KEY, GF_DD_STEP_KEY, resolveLabelTokens } from "../../lib/label-keys.ts";

// S9 실사·검증 — 표준 DD 체크리스트 판정 + 산업 맞춤 제안 승인 화면 (ADR-0099 §4).
// 표준 체크리스트 3개(commercial/technical/legal) 탭 + 산업 맞춤 제안 패널
// + dd_finding 목록 + GateDecisionPanel(gate=dd). 경계 #2: 에이전트는 제안만
// 하고, 제안의 승인(판정 대상 편입)과 dd 진행 기록은 사람이 한다. 출처 없는
// 제안은 "출처 없음 (C)"로 눈에 보이게 표시된다 — 결코 출처가 있는 것처럼
// 보이지 않는다 (ADR-0099 §6 정직성 제약).

/** Column shares (%): item, required, judgement, [record actions]. Read-only viewers have no actions column. */
const DD_COL_PCT_ACT = [44, 9, 17, 30] as const;
const DD_COL_PCT_READONLY = [64, 12, 24] as const;
/** Column shares (%): step, scope, status, evidence / link. */
const PLAN_COL_PCT = [30, 20, 20, 30] as const;
// 대상별 DD 비교 근거 7열 — 대상·구분 + 수치 5열.
const DD_COMPARE_COL_PCT = [22, 12, 11, 11, 11, 11, 22] as const;

interface ItemState {
  status: string;
  note: string | null;
  evidence_ref: string | null;
  waiver_id: string | null;
  assessed_by?: string | null;
  assessed_at?: string | null;
}
interface StdItem {
  scope?: WsItemScope;
  id: string;
  text: string;
  mandatory: boolean;
  waiver_eligible: boolean;
  review_status?: ReviewStatus;
  reviewer?: string;
  verified_on?: string;
  state: ItemState | null;
}
interface CustomItem {
  id: string;
  domain: string;
  item_label: string;
  rationale: string | null;
  source_url: string | null;
  source_reliability: string | null;
  proposed_by_agent: string | null;
  proposed_by_user: string | null;
  is_proposer: boolean;
  status: "proposed" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  state: ItemState | null;
}
interface FindingRow {
  id: string;
  category: string;
  description: string;
  value_impact: number | null;
  assumption_key: string | null;
  evidence_ref: string | null;
  created_at: string;
}
interface DomainView {
  domain: string;
  checklistId: string;
  title: string;
  items: StdItem[];
  custom: CustomItem[];
  /** ADR-0148 section 6B: false = judgeable and recorded, but outside the completion count (project created before 2026-10-01). */
  counted?: boolean;
  counted_reason?: string;
}
/** ADR-0157: one row per shortlisted target — the comparison-table source. */
interface DdTargetRow {
  target_id: string;
  name: string;
  is_selected: boolean;
  opened: boolean;
  opened_at: string | null;
  opened_by: string | null;
  rationale: string | null;
  total: number;
  unassessed: number;
  pending: number;
  mandatory_unmet: number;
  findings: number;
  findings_with_value_impact: number;
}
interface WorkspaceView {
  domains: DomainView[];
  findings: FindingRow[];
  completion: { total: number; pending: number; unassessed: number; mandatoryUnmet: number };
  scope_target_id: string | null;
  selected_target_id: string | null;
  targets: DdTargetRow[];
  /** 2026-10-21 decider — record counts for the workspace's diligence tools (main scope only). */
  tool_counts?: {
    contracts: { total: number; plotted: number };
    compensation: { packages: number; parity_rows: number };
    interviews: { total: number; triangulated_claims: number; pending_claims: number };
    heatmap: { total: number; high: number };
  } | null;
  /** ADR-0160: present for greenfield routes only; absent for brownfield (payload unchanged). */
  greenfield_scope?: GfScope;
  /** ADR-0162: present only for brownfield non-baseline sub-tracks in the scoped view; absent for m_and_a, null and grandfathered (payload unchanged). */
  brownfield_scope?: BfScopeBlock;
}

// P5: 상태는 색+아이콘+텍스트의 조합 — 색 단독으로 상태를 전달하지 않는다.
const STATE_META = (tr: TranslatorFn): Record<string, { icon: string; label: string; cls: string }> => ({
  pending: { icon: "○", label: "stages.s9.stage.judgementPending", cls: "status-not-started" },
  pass: { icon: "✓", label: "stages.s9.stage.met", cls: "status-green" },
  fail: { icon: "✕", label: "stages.s9.stage.notMet", cls: "status-red" },
  na: { icon: "—", label: "stages.s9.stage.notApplicable", cls: "status-not-started" },
  waived: { icon: "⚖", label: "stages.s9.stage.waived", cls: "status-amber" },
});

function stateMeta(status: string | undefined, tr: TranslatorFn) {
  const m = STATE_META(tr)[status ?? "pending"];
  return m ? { ...m, label: tr(m.label) } : { icon: "?", label: status ?? "unknown", cls: "status-not-started" };
}

export function DdStage({ projectId }: { projectId: string }) {const tr = useTranslations(); const t = useTranslations("stages.s9.stage"); const tc = useTranslations("common");
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const { confirm, confirmDialog } = useConfirm();
  const [data, setData] = useState<WorkspaceView | null>(null);
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { toast } = useToast();
  const [filter, setFilter] = useState<ItemFilter>("all");
  // ADR-0157: null = the selected target the gate judges; an id = a comparison target (비교 근거).
  const [viewTarget, setViewTarget] = useState<string | null>(null);
  const [naDlg, setNaDlg] = useState<{ checklistId: string; itemId: string; label: string } | null>(null);
  const [openDlg, setOpenDlg] = useState<{ targetId: string; name: string } | null>(null);
  // Row-level waiver dialog (R2-B item 5): link an active waiver, or request a new one prefilled with the item.
  const [waiverDlg, setWaiverDlg] = useState<{
    checklistId: string; itemId: string; label: string;
    active: Array<{ id: string; clause_ref: string; governance_doc_id: string; expires_at: string }>;
    docs: Array<{ id: string; layer: string; key: string; title: string }>;
  } | null>(null);

  const load = useCallback((scope: string | null) => {
    const qs = scope ? `?target_id=${encodeURIComponent(scope)}` : "";
    api.get<WorkspaceView>(`/api/projects/${encodeURIComponent(projectId)}/dd${qs}`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadDueDiligence")));
  }, [projectId]);

  // 2026-10-19 decider-approved option: adopt the four newer DD domains into this
  // project's S9 completion count — person-only, rationale mandatory, audited.
  const [adopt, setAdopt] = useState<{ adopted: boolean; rationale: string; by: string; at: string } | null>(null);
  const [adoptRationale, setAdoptRationale] = useState("");
  const [adoptBusy, setAdoptBusy] = useState(false);
  useEffect(() => {
    api.get<{ adoption: { adopted: boolean; rationale: string; by: string; at: string } | null }>(
      `/api/projects/${encodeURIComponent(projectId)}/dd-domain-adopt`,
    ).then((r) => setAdopt(r.data.adoption)).catch(() => setAdopt(null));
  }, [projectId]);

  async function submitAdopt() {
    if (adoptBusy || adoptRationale.trim().length < 10) return;
    setAdoptBusy(true); setError(null);
    try {
      const r = await api.post<{ adoption: { adopted: boolean; rationale: string; by: string; at: string } | null }>(
        `/api/projects/${encodeURIComponent(projectId)}/dd-domain-adopt`,
        { adopt: true, rationale: adoptRationale.trim() },
      );
      setAdopt(r.data.adoption);
      setAdoptRationale("");
      setNotice(t("theAdditionalDdDomainsFinancial"));
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToSetTheReflection"));
    } finally {
      setAdoptBusy(false);
    }
  }

  useEffect(() => { load(null); }, [load]);

  const targets = data?.targets ?? [];
  // 실사 조사 도구 트랙 필터 (2026-10-21 decider): greenfield는 고객 CoC·경영진 보상
  // (M&A 실사 항목)이 도메인 범위 밖 — ADR-0160/0162의 도메인 범위를 따른다.
  const toolsGf = !!data?.greenfield_scope;
  const selectedTarget = targets.find((t) => t.is_selected) ?? null;
  const viewSummary = viewTarget ? targets.find((t) => t.target_id === viewTarget) ?? null : null;
  // A comparison target whose DD was never opened has no checklist to show or edit.
  const viewNotOpened = !!viewSummary && !viewSummary.opened;
  const scopeParam = viewSummary?.opened ? viewSummary.target_id : null;
  const comparing = scopeParam !== null;
  const reload = () => load(scopeParam);

  const selectorTargets: AnalysisTarget[] = [...targets]
    .sort((a, b) => Number(b.is_selected) - Number(a.is_selected))
    .map((tgt) => ({
      targetId: tgt.target_id,
      name: tgt.name,
      // The selector's "no company data" hint is a financial-analysis concern; DD has no such limit.
      companyId: tgt.target_id,
      isBound: tgt.is_selected,
      note: tgt.is_selected ? undefined : tgt.opened ? tc("compareEvidence") : t("ddNotOpened"),
    }));
  const comparisonRows = targets.filter((t) => t.is_selected || t.opened);

  function chooseTarget(id: string | null) {
    const next = id === null || id === selectedTarget?.target_id ? null : id;
    setViewTarget(next);
    setTab(0); setError(null); setNotice(null);
    const summary = next ? targets.find((t) => t.target_id === next) : null;
    if (next === null) load(null);
    else if (summary?.opened) load(next);
  }

  async function tailor(regenerate = false) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api.post<{ runId: string; proposedCount: number }>(
        `/api/projects/${encodeURIComponent(projectId)}/dd-checklist/tailor`,
        { ...(scopeParam ? { target_id: scopeParam } : {}), ...(regenerate ? { regenerate: true } : {}) },
      );
      setNotice(
        t("proposalP1DoneP2Proposal", { p1: regenerate ? tc("regenerate") : t("generate"), p2: r.data.proposedCount }),
      );
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToGenerateProposals"));
    } finally {
      setBusy(false);
    }
  }

  function review(item: CustomItem, decision: "approved" | "rejected") {
    confirm(
      decision === "approved" ? t("approveItem") : t("dismissItem"),
      () => {
        void (async () => {
          setBusy(true); setError(null);
          try {
            await api.put(
              `/api/projects/${encodeURIComponent(projectId)}/dd-checklist/tailor/${encodeURIComponent(item.id)}/review`,
              { decision },
            );
            setNotice(
              decision === "approved"
                ? t("approvedTheItemJoinedThe")
                : t("dismissedTheItemWasRemoved"),
            );
            reload();
          } catch (e) {
            setError((e as { code?: string } | null)?.code === "second_person_required" ? t("thePersonWhoProposedA") /* INTERIM-WORDING */ : e instanceof Error ? e.message : t("approveDismissFailed"));
          } finally {
            setBusy(false);
          }
        })();
      },
      {
        body:
          decision === "approved"
            ? t("addsThisItemToThe")
            : t("dismissesThisProposalDismissedItems"),
        confirmLabel: decision === "approved" ? tc("approve") : tc("dismiss"),
      },
    );
  }

  async function judge(checklistId: string, itemId: string, status: "pass" | "fail" | "na", note?: string) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.put(`/api/projects/${encodeURIComponent(projectId)}/dd-checklist/state`, {
        checklist_id: checklistId,
        item_id: itemId,
        status,
        ...(note ? { note } : {}),
        target_id: scopeParam ?? undefined,
      });
      setNotice(t("judgementRecorded"));
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToRecordTheJudgement"));
    } finally {
      setBusy(false);
    }
  }

  /** `na` on a sub-track-ruled checklist needs a written reason (ADR-0160 section 4.4); other `na` judgements are unchanged. */
  function requestNa(checklistId: string, itemId: string, label: string) {
    if (needsNaReason(data?.greenfield_scope, checklistId, itemId) || bfNeedsNaReason(data?.brownfield_scope, checklistId)) setNaDlg({ checklistId, itemId, label });
    else void judge(checklistId, itemId, "na");
  }

  /** 면제 - 항목 행에서 바로 연다: 활성 waiver 연결 또는 항목이 채워진 새 요청. */
  function openWaiverDialog(checklistId: string, itemId: string, label: string) {
    setError(null);
    api.get<{ waivers: Array<{ id: string; clause_ref: string; governance_doc_id: string; expires_at: string; effective_status: string }>; governanceDocs: Array<{ id: string; layer: string; key: string; title: string }> }>(
      `/api/projects/${encodeURIComponent(projectId)}/waivers${scopeParam ? `?target_id=${encodeURIComponent(scopeParam)}` : ""}`,
    )
      .then((r) => setWaiverDlg({ checklistId, itemId, label, active: r.data.waivers.filter((w) => w.effective_status === "active"), docs: r.data.governanceDocs }))
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToFetchTheWaiver")));
  }

  async function judgeWaived(waiverId: string) {
    if (!waiverDlg || busy) return;
    setBusy(true); setError(null);
    try {
      await api.put(`/api/projects/${encodeURIComponent(projectId)}/dd-checklist/state`, {
        checklist_id: waiverDlg.checklistId,
        item_id: waiverDlg.itemId,
        status: "waived",
        waiver_id: waiverId,
        target_id: scopeParam ?? undefined,
      });
      setNotice(t("aJudgementLinkedToA"));
      toast(t("waivedJudgementRecorded"));
      setWaiverDlg(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToRecordWaivedJudgement"));
    } finally {
      setBusy(false);
    }
  }

  const domain = data?.domains[tab];
  const rowCanAct = canAct;
  const ws = workspaceView(data?.greenfield_scope);
  const bf = bfScopeBlock(data?.brownfield_scope);
  // The virtual "plan readiness" tab sits after the real domain tabs (workspace scope only).
  // 2026-10-19 decider direction: Brownfield adds a 필요 역량 검증 tab (capability-dd) and the
  // gate decision becomes its OWN tab at the very end — never a tail panel repeated per tab.
  const planTab = !!ws && !!data && tab === data.domains.length;
  const isBrownfield = !!bf;
  const capTabIdx = data ? data.domains.length + (ws ? 1 : 0) : -1;
  const capTab = isBrownfield && !!data && tab === capTabIdx;
  const decisionTabIdx = data ? capTabIdx + (isBrownfield ? 1 : 0) : -1;
  const decisionTab = !!data && tab === decisionTabIdx;
  // 조사내역 정정 (2026-10-19 decider): recorded findings were append-only; the person
  // now can correct or remove a mis-recorded finding (analyst+, audited).
  const [editingFinding, setEditingFinding] = useState<string | null>(null);
  const [findingDraft, setFindingDraft] = useState<{ description: string; value_impact: string; evidence_ref: string }>({ description: "", value_impact: "", evidence_ref: "" });

  async function saveFinding(fid: string) {
    if (busy) return;
    const valueImpact = findingDraft.value_impact.trim() === "" ? null : Number(findingDraft.value_impact);
    if (findingDraft.value_impact.trim() !== "" && !Number.isInteger(valueImpact)) {
      setError(t("enterTheValueImpactAs")); return;
    }
    setBusy(true); setError(null);
    try {
      await api.put(`/api/projects/${encodeURIComponent(projectId)}/dd/findings`, {
        finding_id: fid, description: findingDraft.description, value_impact: valueImpact, evidence_ref: findingDraft.evidence_ref,
      });
      setNotice(t("findingAmendedTheReflectionPath"));
      setEditingFinding(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToAmendTheFinding"));
    } finally {
      setBusy(false);
    }
  }

  function removeFinding(fid: string) {
    confirm(t("deleteFinding"), () => {
      void (async () => {
        setBusy(true); setError(null);
        try {
          await api.delete(`/api/projects/${encodeURIComponent(projectId)}/dd/findings`, { finding_id: fid });
          setNotice(t("findingDeletedRecordedInThe"));
          reload();
        } catch (e) {
          setError(e instanceof Error ? e.message : t("failedToDeleteTheFinding"));
        } finally { setBusy(false); }
      })();
    }, { body: t("deletedFindingsAreAlsoExcluded"), tone: "danger" });
  }

  // Decision-tab summary: verdict COUNTS only — for Brownfield the acquisition itself is the
  // capability resolution, so no cost input and no business-case reflection (decider 2026-10-19).
  const [capSummary, setCapSummary] = useState<{ resolved: number; partial: number; unresolved: number; pending: number } | null>(null);
  useEffect(() => {
    if (!isBrownfield) return;
    api.get<{ rows: Array<{ verdict: { coverage: string } | null }>; pending: number }>(
      `/api/projects/${encodeURIComponent(projectId)}/capability-dd`,
    ).then((r) => {
      const rows = r.data.rows ?? [];
      setCapSummary({
        resolved: rows.filter((x) => x.verdict?.coverage === "resolved").length,
        partial: rows.filter((x) => x.verdict?.coverage === "partial").length,
        unresolved: rows.filter((x) => x.verdict?.coverage === "unresolved").length,
        pending: r.data.pending ?? 0,
      });
    }).catch(() => setCapSummary(null));
  }, [isBrownfield, projectId, tab]);
  const domainTabs = (data?.domains ?? []).map((d, i) => ({ key: String(i), label: resolveLabelTokens(tabLabel(data?.greenfield_scope, d), tr) }));
  const tabItems = data
    ? [
        ...domainTabs,
        ...(ws ? [{ key: String(data.domains.length), label: resolveLabelTokens(planReadinessLabel(data.greenfield_scope), tr) }] : []),
        ...(isBrownfield ? [{ key: String(capTabIdx), label: t("requiredCapabilityVerification") }] : []),
        { key: String(decisionTabIdx), label: tc("decisionMaking") },
      ]
    : domainTabs;
  const headerCount = countLocation(data?.greenfield_scope) === "header" ? judgedLine(data?.greenfield_scope, data?.domains ?? []) : null;
  const split = domain ? splitItems(domain.items) : null;
  const counts = domain ? tabCounts(domain) : null;
  const stepTags = domain ? tabStepTags(data?.greenfield_scope, domain) : [];
  const notCounted = domain ? notCountedNotice(domain) : null;
  const previousHere = domain ? (ws ? ws.previous_scope.filter((p) => p.checklist_id === domain.checklistId) : bfPreviousForTab(bf, domain.checklistId)) : [];

  const bfExtraTab = !!domain && isBfExtraTab(bf, domain.checklistId);

  return (
<>
      {/* 리뷰 2026-10-22 (사용자 리포트): StageTabs를 레일 슬롯으로 — h1·스트립이
          탭 행 아래로 밀리지 않고 S1~S7 딜 화면과 같은 머리 위치를 유지한다. */}
      <StageFrame
        stageId="S9"
        heading={resolveLabelTokens(s9Heading(data?.greenfield_scope), tr)}
        railSlot={<StageTabs projectId={projectId} />}
      >
        <GateDecisionJump gate="dd" beforeJump={() => { if (data) setTab(decisionTabIdx); }} />
        <ReviewBuckets entityType="project" entityId={projectId} gates={["dd"]} artifacts={stageArtifactTabs("S9")} />
        {data && (
          <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="dd-subject-header">
            {targets.length === 0 ? (
              <p className="text-[length:var(--fs-body)]">
                <strong>{tc("ddTargetColon")}</strong> {t("noTargetCompanyAssignedThis")}
              </p>
            ) : !selectedTarget ? (
              <p className="text-[length:var(--fs-body)]">
                <strong>{tc("ddTargetColon")}</strong> {t("notYetSelectedOnceA")}
              </p>
            ) : (
              <>
                <p className="text-[length:var(--fs-body)]">
                  <strong>{tc("ddTargetColon")}</strong> <strong data-testid="dd-subject-name">{(viewSummary ?? selectedTarget).name}</strong>
                </p>
                {viewSummary && viewSummary.target_id !== selectedTarget.target_id ? (
                  <span className="status-chip status-amber">{tc("compareEvidence")}</span>
                ) : (
                  <span className="status-chip status-green">{t("s8SelectedTargetGateCriteria")}</span>
                )}
              </>
            )}
          </div>
        )}

        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          {t("s9CompletesOnlyWhenEvery")}
          {data && (
            <>
              {countLocation(data.greenfield_scope) === "panel" ? null : <>{" — "}
              <span className={`status-chip ${data.completion.pending === 0 && data.completion.unassessed === 0 && data.completion.mandatoryUnmet === 0 && data.completion.total > 0 ? "status-green" : "status-amber"}`}>
                {data.completion.total === 0 && data.completion.unassessed === 0
                  ? t("noJudgementRecord")
                  : data.completion.pending === 0 && data.completion.unassessed === 0 && data.completion.mandatoryUnmet === 0
                    ? t("judgementCompleteZeroUnmetRequired")
                    : t("pendingP1UnjudgedP2Unmet", { p1: data.completion.pending, p2: data.completion.unassessed, p3: data.completion.mandatoryUnmet })}
              </span>
              {headerCount && (
                <span className="ml-2 status-chip status-not-started" role="status" aria-live="polite" aria-atomic="true" data-testid="dd-header-judged">
                  {headerCount.text}<span className="sr-only">{countAnnouncement(headerCount)}</span>
                </span>
              )}</>}
            </>
          )}
          <span className="ml-2 status-chip status-not-started">{t("agentProposalIsNotApproval")}</span>
        </p>

        {data?.greenfield_scope && (
          <GreenfieldScopePanel
            projectId={projectId}
            scope={data.greenfield_scope}
            domains={data.domains}
            meUserId={me?.userId ?? null}
            canAct={canAct}
            onChanged={reload}
            onSelectTab={setTab}
          />
        )}

        {/* ── 실사 조사 도구 (2026-10-21 decider) — 실사 산물인 조사 화면을 워크스페이스에서 한 눈에 ── */}
        {data?.tool_counts && (
          <section className="market-section sizing-step mb-3" aria-label={t("ddInvestigationTools")} data-testid="dd-tools">
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">
              <span className="sizing-step-badge" aria-hidden="true">🧰</span> {t("ddInvestigationToolsScreensRecording")}
            </h3>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {t("recordsFromTheseScreensFlow")}
              {toolsGf
                ? t("forGreenFieldCustomerAnd")
                : t("brownFieldAlsoIncludesCustomer")}
            </p>
            <ul className="grid gap-2 md:grid-cols-4 list-none p-0 m-0">
              <li>
                <Link href={`/projects/${projectId}/interviews`} className="card block" data-testid="dd-tool-interviews">
                  <strong>{t("expertInterviewsAndChannelChecks")}</strong>
                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("atLeastTwoIndependentSources")}</span>
                  <span className={`status-chip ${data.tool_counts.interviews.pending_claims > 0 ? "status-amber" : "status-green"} mt-1`}>{t("interviews")} {data.tool_counts.interviews.total}{t("itemSTriangulated")} {data.tool_counts.interviews.triangulated_claims} {t("notMet2")} {data.tool_counts.interviews.pending_claims}</span>
                </Link>
              </li>
              <li>
                <Link href={`/projects/${projectId}/risk-heatmap`} className="card block" data-testid="dd-tool-heatmap">
                  <strong>{t("riskHeatmap")}</strong>
                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("consolidatedDdCocClawbackAnd")}</span>
                  <span className={`status-chip ${data.tool_counts.heatmap.high > 0 ? "status-red" : "status-green"} mt-1`}>{tc("items")} {data.tool_counts.heatmap.total}{t("itemSHigh")} {data.tool_counts.heatmap.high}{tc("countUnit")}</span>
                </Link>
              </li>
              {!toolsGf && (
              <li>
                <Link href={`/projects/${projectId}/customer-coc`} className="card block" data-testid="dd-tool-coc">
                  <strong>{t("customerConcentrationAndChangeOf")}</strong>
                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("n08ContractScanAutomaticFlag")}</span>
                  <span className="status-chip status-not-started mt-1">{tc("record")} {data.tool_counts.contracts.total}{t("itemSFlagged")} {data.tool_counts.contracts.plotted}{tc("countUnit")}</span>
                </Link>
              </li>
              )}
              {!toolsGf && (
              <li>
                <Link href={`/projects/${projectId}/comp-parity`} className="card block" data-testid="dd-tool-comp">
                  <strong>{t("executiveCompensationAndPayParity")}</strong>
                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("hddCocTriggerCompensationAggregation")}</span>
                  <span className="status-chip status-not-started mt-1">{t("package")} {data.tool_counts.compensation.packages}{t("itemSParity")} {data.tool_counts.compensation.parity_rows}{tc("countUnit")}</span>
                </Link>
              </li>
              )}
            </ul>
          </section>
        )}

        {data && !data.greenfield_scope && (
          <BrownfieldScopePanel
            projectId={projectId}
            block={data.brownfield_scope}
            domains={data.domains}
            canAct={canAct}
            previewEnabled={!comparing}
            onChanged={reload}
          />
        )}

        {targets.length >= 2 && selectedTarget && (
          <div className="mb-3">
            <TargetSelector
              targets={selectorTargets}
              selected={viewTarget ?? selectedTarget.target_id}
              onSelect={chooseTarget}
              boundLabel={t("selectedTarget")}
              ariaLabel={t("selectDdTarget")}
            />
            {comparing && (
              <p role="note" className="status-chip status-amber mt-2" data-testid="dd-comparison-banner">
                <span aria-hidden="true">⚠ </span>{t("comparisonEvidenceNotReflectedIn")}
              </p>
            )}
          </div>
        )}

        {comparisonRows.length >= 2 && (
          <section className="market-section sizing-step mb-3" aria-label={tc("compareEvidence")}>
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">{tc("compareEvidence")}</h3>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {t("openDdStatusShowsThe")}
            </p>
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-56" aria-label={t("ddComparisonEvidence")}>
                <caption className="sr-only">{t("openDdComparisonEvidenceAll")}</caption>
                <ColGroup widths={DD_COMPARE_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">{t("target")}</th>
                    <th scope="col">{tc("division")}</th>
                    <th scope="col" className="col-num">{t("allItems")}</th>
                    <th scope="col" className="col-num">{tc("unjudged")}</th>
                    <th scope="col" className="col-num">{t("judgementPending2")}</th>
                    <th scope="col" className="col-num">{t("requiredCriteriaNotMet")}</th>
                    <th scope="col" className="col-num">{t("valueImpactFindings")}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => (
                    <tr key={row.target_id}>
                      <th scope="row" data-label={tc("subjectTarget")}>{row.name}</th>
                      <td data-label={tc("division")}>{row.is_selected ? t("selectedTargetGateJudgement") : tc("compareEvidence")}</td>
                      <td data-label={t("allItems")} className="col-num tabular-nums">{row.total}</td>
                      <td data-label={tc("unjudged")} className="col-num tabular-nums">{row.unassessed}</td>
                      <td data-label={t("judgementPending")} className="col-num tabular-nums">{row.pending}</td>
                      <td data-label={t("requiredCriteriaNotMet")} className="col-num tabular-nums">{row.mandatory_unmet}</td>
                      <td data-label={t("valueImpactFindings")} className="col-num tabular-nums">{row.findings_with_value_impact} / {row.findings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {viewNotOpened && viewSummary && (
          <section className="market-section sizing-step mb-3" aria-label={t("targetsWithDdNotOpened")}>
            <p className="text-[length:var(--fs-body)] mb-2">
              <strong>{viewSummary.name}</strong>{t("ddHasNotBeenOpened")}
            </p>
            {canAct ? (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpenDlg({ targetId: viewSummary.target_id, name: viewSummary.name })}>
                {t("openDd")}
              </button>
            ) : (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("onlyAPersonWithThe")}</p>
            )}
          </section>
        )}

        {canAct && !viewNotOpened && (
          <div className="mb-3">
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => {
              const hasProposed = (data?.domains ?? []).some((d) => d.custom.some((c) => c.status === "proposed"));
              if (hasProposed) {
                confirm(
                  t("regenerateProposals"),
                  () => { void tailor(true); },
                  { body: t("deletesPendingProposalsUnapprovedAi") },
                );
              } else {
                void tailor(false);
              }
            }}>
              {busy ? tc("creating") : t("generateOrRegenerateProposals")}
            </button>
          </div>
        )}

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}

        <div className="mt-3">
          <WaiverPanel projectId={projectId} targetId={scopeParam} />
        </div>
        {(domain || planTab || capTab || decisionTab) && !viewNotOpened && (
          <>
            <TabNav
              className="mb-0"
              label={t("ddChecklistDomain")}
              active={String(tab)}
              onSelect={(key) => setTab(Number(key))}
              tabs={tabItems}
            />
            {planTab && ws && (
              <section className="market-section sizing-step mt-3" aria-label={t("planReadiness")} data-testid="dd-plan-readiness">
                <h3 className="sizing-step-title text-[length:var(--fs-body)]">{resolveLabelTokens(planReadinessLabel(data?.greenfield_scope), tr)}</h3>
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                  {t("statusOfStepsWithoutChecklist")} {/* INTERIM-WORDING */}
                </p>
                <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                  <table className="data-table table-fixed-pct tmin-40" aria-label={t("planReadiness2")}>
                    <caption className="sr-only">{t("statusOfSteps45")}</caption>
                    <ColGroup widths={PLAN_COL_PCT} />
                    <thead>
                      <tr><th scope="col">{tc("stage")}</th><th scope="col">{t("scope")}</th><th scope="col">{tc("status")}</th><th scope="col">{t("evidenceAndLinkage")}</th></tr>
                    </thead>
                    <tbody>
                      {ws.plan_readiness.map((r) => {
                        const st = PLAN_STATUS_TEXT[r.status];
                        const href = planArtefactHref(r.step);
                        return (
                          <tr key={r.step}>
                            <th scope="row" data-label={tc("stage")} className="text-left">{r.step}{tc("stage")} {resolveLabelTokens(GF_DD_STEP_KEY[r.step] ?? r.purpose, tr)}</th>
                            <td data-label={t("scope")}>{r.in_scope ? t("inRange") : t("outOfScope")}{r.reason && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{r.reason}</span>}</td>
                            <td data-label={tc("status")}><span className={`status-chip ${r.status === "recorded" ? "status-green" : "status-not-started"}`}>{st.icon} {st.text}</span></td>
                            <td data-label={t("evidenceAndLinkage")}>
                              {r.detail && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{r.detail}</span>}
                              {r.artefact && <span className="block text-[length:var(--fs-caption)]">{r.artefact}</span>}
                              {href && <a className="text-[length:var(--fs-caption)]" href={href}>{t("goToThatLocation")}</a>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {capTab && <CapabilityDdTab projectId={projectId} />}

            {domain && split && counts && (<>
            <div className="mt-3 mb-2" data-testid="dd-tab-header">
              <h3 className="sizing-step-title text-[length:var(--fs-body)]">
                {resolveLabelTokens(tabLabel(data?.greenfield_scope, domain), tr)}
                {(ws || bf) && (
                  <span className="ml-2 text-[length:var(--fs-caption)] font-normal text-[color:var(--muted-fg)]" role="status" aria-live="polite" data-testid="dd-tab-count">
                    {t("inThisTab")} {counts.judged} / {counts.judgeable} {tc("judgement")}
                  </span>
                )}
              </h3>
              {stepTags.length > 0 && (
                <ul className="flex flex-wrap gap-2 mt-1" aria-label={t("procedureStepsThisTabCovers")} data-testid="dd-step-tags">
                  {stepTags.map((tag2) => (
                    <li key={tag2.step} className={`status-chip ${tag2.inScope ? "status-green" : "status-not-started"}`} title={tag2.reason ?? undefined}>
                      <span aria-hidden="true">{tag2.icon} </span>{tag2.step}{tc("stage")} {resolveLabelTokens(tag2.label, tr)} — {tag2.stateText}{tag2.reason ? ` (${tag2.reason})` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {notCounted && (
                <p role="note" className="status-chip status-amber block mt-2" data-testid="dd-not-counted">
                  <span aria-hidden="true">ⓘ </span>{notCounted.text}
                </p>
              )}
              {notCounted && canAct && !adopt?.adopted && (
                <div className="mt-2 mb-1 grid gap-1" data-testid="dd-adopt">
                  <label className="text-[length:var(--fs-caption)] block" htmlFor="dd-adopt-rationale">
                    {t("theseDomainsCanBeReflected")}
                  </label>
                  <textarea
                    id="dd-adopt-rationale"
                    className="sizing-new-input sizing-new-input-sm w-full"
                    rows={2}
                    value={adoptRationale}
                    placeholder={t("eGThisDealSubstantively")}
                    onChange={(e) => setAdoptRationale(e.target.value)}
                  />
                  <button type="button" className="btn-ghost btn-sm justify-self-start" disabled={adoptBusy || adoptRationale.trim().length < 10} onClick={() => void submitAdopt()} data-testid="dd-adopt-submit">
                    {adoptBusy ? t("reflecting") : t("reflectAdditionalDdDomainsIn")}
                  </button>
                </div>
              )}
              {domain.domain === "hr" && ws && (
                <p role="note" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2" data-testid="dd-hr-tab-hint">
                  {t("theStaffingAndOrganizationTab")}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label={t("itemFilter")}>
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("view")}</span>
              {([["all", tc("all")], ["pending", t("only")], ["fail", t("only2")]] as const).map(([k, label]) => (
                <button key={k} type="button" className="control-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
              ))}
              {!canAct && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("onlyTheAnalystRoleOr")}</span>}
              {busy && <span role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("recordingJudgementButtonsStayLocked")}</span>}
            </div>
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table dd-table table-fixed-pct tmin-48" aria-label={t("p1Checklist", { p1: resolveLabelTokens(tabLabel(data?.greenfield_scope, domain), tr) })}>
              <caption className="sr-only">{resolveLabelTokens(tabLabel(data?.greenfield_scope, domain), tr)} {t("checklistJudgement")}</caption>
              <ColGroup widths={rowCanAct ? DD_COL_PCT_ACT : DD_COL_PCT_READONLY} />
              <thead>
                <tr>
                  <th scope="col">{tc("items")}</th>
                  <th scope="col">{t("required")}</th>
                  <th scope="col">{tc("judgement")}</th>
                  {rowCanAct && <th scope="col">{t("judgementRecord")}</th>}
                </tr>
              </thead>
              <tbody>
                {split.judgeable.map((item) => {
                  const display = ddItemDisplay(item.state);
                  if (!matchesFilter(filter, display)) return null;
                  const meta = stateMeta(display.status, tr);
                  const ko = koChecklistText(domain.checklistId, item.id, item.text);
                  return (
                    <tr key={item.id}>
                      <td data-label={tc("items")}>
                        {/* 2026-10-19 decider: the 검토 상태 chip left the row — the id carries
                            the full draft-AI tooltip, counsel-reviewed/confirmed keep their chips. */}
                        <span
                          className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums mr-1"
                          title={reviewBadge(item).status === "draft-AI" ? t("reviewStatusP1", { p1: DRAFT_AI_MARKER }) : undefined}
                        >
                          {item.id}
                        </span>
                        <span title={ko.translated ? item.text : undefined}>{ko.text}</span>
                        {item.state?.waiver_id && <span className="status-chip status-amber ml-1" title={`waiver ${item.state.waiver_id}`}>⚖ waiver</span>}
                        {reviewBadge(item).status !== "draft-AI" && <ReviewBadgeChip item={item} />}
                        {item.scope && <ScopeNote sc={item.scope} brownfield={!!bf} />}
                      </td>
                      <td data-label={tc("required")}>{item.mandatory ? t("required2") : tc("select")}</td>
                      <td data-label={tc("judgement")}>
                        <span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span>
                        <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{display.judged ? (display.byline ? t("judgementP1", { p1: display.byline }) : t("judged")) : t("notYetJudged")}</span>
                      </td>
                      {rowCanAct && (
                        <td data-label={t("judgementRecord")}>
                          <span className="actions-row dd-actions">
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title={t("metJudgement")} aria-label={t("markP1Met", { p1: ko.text })} onClick={() => void judge(domain.checklistId, item.id, "pass")}>{t("met2")}</button>
                            <button type="button" className="btn-danger btn-sm" disabled={busy} title={t("judgementRequiredItemsCannotClose")} aria-label={t("markP1NotMet", { p1: ko.text })} onClick={() => void judge(domain.checklistId, item.id, "fail")}>{t("notMet3")}</button>
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title={t("judgement")} aria-label={t("markP1NotApplicable", { p1: ko.text })} onClick={() => requestNa(domain.checklistId, item.id, `${item.id} ${ko.text}`)}>{t("notApplicable2")}</button>
                            {item.waiver_eligible ? (
                              <button type="button" className="btn-ghost btn-sm" disabled={busy} aria-label={t("p1WaiverRequestAndLink", { p1: ko.text })} onClick={() => openWaiverDialog(domain.checklistId, item.id, `${item.id} ${ko.text}`)}>
                                {t("waiverRequestAndLink")}
                              </button>
                            ) : (
                              <span className="dd-nowaive text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{nonWaivableReason(domain.checklistId, item.id)}</span>
                            )}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {/* 승인된 맞춤 항목은 일반 항목이다 — 같은 표에서 같은 방식으로 판정된다 (ADR-0099 §4). */}
                {domain.custom.filter((c) => c.status === "approved").map((c) => {
                  const display = ddItemDisplay(c.state);
                  if (!matchesFilter(filter, display)) return null;
                  const meta = stateMeta(display.status, tr);
                  return (
                    <tr key={c.id}>
                      <td data-label={tc("items")}>
                        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums mr-1">{resolveLabelTokens(DD_DOMAIN_KEY[c.domain] ?? c.domain, tr)}-custom</span>
                        {c.item_label}
                        <span className="status-chip status-not-started ml-1" title={t("itemsApprovedFromProposals")}>{t("custom")}</span>
                        {c.state?.waiver_id && <span className="status-chip status-amber ml-1" title={`waiver ${c.state.waiver_id}`}>⚖ waiver</span>}
                      </td>
                      <td data-label={tc("required")}>{t("requiredAddedOnApproval")}</td>
                      <td data-label={tc("judgement")}>
                        <span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span>
                        <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{display.judged ? (display.byline ? t("judgementP12", { p1: display.byline }) : t("judged2")) : t("notYetJudged2")}</span>
                      </td>
                      {rowCanAct && (
                        <td data-label={t("judgementRecord")}>
                          <span className="actions-row dd-actions">
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title={t("metJudgement2")} aria-label={t("markP1Met2", { p1: c.item_label })} onClick={() => void judge(`custom:${c.domain}`, c.id, "pass")}>{t("met3")}</button>
                            <button type="button" className="btn-danger btn-sm" disabled={busy} title={t("judgementRequiredItemsCannotClose2")} aria-label={t("markP1NotMet2", { p1: c.item_label })} onClick={() => void judge(`custom:${c.domain}`, c.id, "fail")}>{t("notMet4")}</button>
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title={t("judgement2")} aria-label={t("markP1NotApplicable2", { p1: c.item_label })} onClick={() => requestNa(`custom:${c.domain}`, c.id, `${c.id} ${c.item_label}`)}>{t("notApplicable3")}</button>
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            {split.excluded.length > 0 && (
              <details className="mt-3" data-testid="dd-excluded">
                <summary className="cursor-pointer text-[length:var(--fs-body)]">{t("itemsExcludedByTrackRules")}{split.excluded.length}{t("itemSNotJudged")}</summary> {/* INTERIM-WORDING */}
                {bfExcludedGroups(split.excluded, bfExtraTab).map((g) => (
                  <div key={g.key} role="group" aria-label={g.label ?? undefined} data-testid={g.label ? "dd-excluded-section" : undefined}>
                    {g.label && <p className="mt-2 text-[length:var(--fs-caption)] font-semibold">{g.label}</p>}
                    <ul className="sizing-note-list mt-2">
                      {g.items.map((item) => {
                        const ko = koChecklistText(domain.checklistId, item.id, item.text);
                        return (
                          <li key={item.id}>
                            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums mr-1">{item.id}</span>
                            {ko.text}
                            {item.scope && <ScopeNote sc={item.scope} brownfield={!!bf} />}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </details>
            )}
            {previousHere.length > 0 && (
              <details className="mt-2" data-testid="dd-previous-scope">
                <summary className="cursor-pointer text-[length:var(--fs-body)]">{t("judgedUnderThePreviousScope")}{previousHere.length}{tc("countSuffixParen")}</summary> {/* INTERIM-WORDING */}
                <ul className="sizing-note-list mt-2">
                  {previousHere.map((p) => (
                    <li key={p.item_id}>
                      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums mr-1">{p.item_id}</span>
                      {p.code === "X" ? t("xReplaced") : t("nNotApplicable")} {t("recordedJudgement")} {statusText(p.status)}
                      {p.assessed_by && ` (${p.assessed_by}${p.assessed_at ? ` · ${p.assessed_at.slice(0, 10)}` : ""})`}
                      {p.stays_unmet && <span className="status-chip status-red ml-1">{t("staysUntilAPersonJudges")}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <section className="market-section sizing-step mt-3" aria-label={t("proposals")}>
              <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("proposalsProposed")}</h3>
              {domain.custom.filter((c) => c.status === "proposed").length === 0 && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noPendingProposalsAgentProposals")}</p>
              )}
              <ul className="sizing-note-list">
                {domain.custom.filter((c) => c.status === "proposed").map((c) => (
                  <li key={c.id}>
                    {c.item_label}
                    <span className="ml-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={proposerLabel(c, tr)}>
                      ({resolveLabelTokens(DD_DOMAIN_KEY[c.domain] ?? c.domain, tr)} · {proposerLabel(c, tr)})
                    </span>
                    {c.rationale && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("evidenceColon")} {c.rationale}</span>}
                    {c.source_url ? (
                      <a className="text-[length:var(--fs-caption)]" href={c.source_url} target="_blank" rel="noreferrer">
                        {t("source")}{c.source_reliability ?? "?"}): {c.source_url}
                      </a>
                    ) : (
                      <span className="status-chip status-amber ml-0" title={t("thisProposalHasNoVerified")}>
                        {t("noSourceC")}
                      </span>
                    )}
                    {canAct && c.is_proposer && (
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="dd-self-approval-hint">{t(SELF_APPROVAL_HINT_KEY)}</span>
                    )}
                    {canAct && !c.is_proposer && (
                      <span className="actions-row ml-2">
                        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => review(c, "approved")}>{tc("approve")}</button>
                        <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => review(c, "rejected")}>{tc("dismiss")}</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            </>)}


            <section className="market-section sizing-step mt-3" aria-label={t("findings")} id="dd-findings">
              <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("findings2")}</h3>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="dd-findings-flow">
                {t("reflectionPathTogetherWithThe")} <b>{t("ddGateJudgementEvidence")}</b>{t("andTheSixMostRecent")}{" "}
                <b>{t("s10InvestmentStructureRecommendation")}</b> {t("isPassedAutomaticallyToThe")} <b>{t("investmentReviewPackage")}</b>{t("asWellThereIsNo")}
              </p>
              {(data?.findings.length ?? 0) === 0 && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noFindingsRegisteredRecordFacts")}</p>
              )}
              <ul className="sizing-note-list">
                {(data?.findings ?? []).map((f) => (
                  <li key={f.id}>
                    <strong>{resolveLabelTokens(DD_DOMAIN_KEY[f.category] ?? f.category, tr)}</strong>:{" "}
                    {editingFinding === f.id ? (
                      <span className="inline-flex flex-wrap gap-1 items-center align-middle">
                        <input aria-label={t("editFinding")} className="sizing-new-input sizing-new-input-sm" style={{ width: "24rem" }} value={findingDraft.description} onChange={(e) => setFindingDraft((d) => ({ ...d, description: e.target.value }))} />
                        <input aria-label={t("editValueImpactKrwMillions")} className="sizing-new-input sizing-new-input-sm" style={{ width: "8rem" }} placeholder={t("valueImpact")} value={findingDraft.value_impact} onChange={(e) => setFindingDraft((d) => ({ ...d, value_impact: e.target.value }))} />
                        <input aria-label={t("editEvidenceReference")} className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} placeholder={t("evidence")} value={findingDraft.evidence_ref} onChange={(e) => setFindingDraft((d) => ({ ...d, evidence_ref: e.target.value }))} />
                        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void saveFinding(f.id)}>{tc("save")}</button>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingFinding(null)}>{tc("cancel")}</button>
                      </span>
                    ) : (
                      <>
                        {f.description}
                        {f.value_impact != null && <span className="status-chip status-info ml-1 tabular-nums" title={t("passedToTheS10Investment")}>{t("valueImpact2")} {f.value_impact} → S10</span>}
                        {f.evidence_ref && <span className="ml-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={t("evidenceReference")}>{tc("proofColon")} {f.evidence_ref}</span>}
                        {canAct && (
                          <span className="actions-row ml-2 align-middle">
                            <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditingFinding(f.id); setFindingDraft({ description: f.description, value_impact: f.value_impact != null ? String(f.value_impact) : "", evidence_ref: f.evidence_ref ?? "" }); }}>{t("amend")}</button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => removeFinding(f.id)}>{tc("delete")}</button>
                          </span>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {(data?.findings.length ?? 0) > 6 && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">
                  {t("theFindings")} {data?.findings.length}{t("itemSOnlyTheSix")}
                </p>
              )}
            </section>
                    {decisionTab && (
          <div className="mt-4">
            {capSummary && (
              <div className="market-section sizing-step mb-3" aria-label={t("requiredCapabilityJudgementSummary")} data-testid="capability-dd-summary">
                <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("requiredCapabilityJudgementSummary2")}</h3>
                <p className="flex flex-wrap gap-2 items-center">
                  <span className="status-chip status-green">{t("resolved")} {capSummary.resolved}</span>
                  <span className="status-chip status-amber">{t("partiallyResolved")} {capSummary.partial}</span>
                  <span className={`status-chip ${capSummary.unresolved > 0 ? "status-red" : "status-not-started"}`}>{t("unresolved")} {capSummary.unresolved}</span>
                  {capSummary.pending > 0 && <span className="status-chip status-amber">{tc("unjudged")} {capSummary.pending}</span>}
                  {capSummary.unresolved + capSummary.partial > 0 && (
                    <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      {t("aCapabilityNotResolvedBy")}
                    </span>
                  )}
                </p>
              </div>
            )}
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="dd-gate-subject">
              {t("gateJudgementSubject")} <strong>{selectedTarget?.name ?? t("noSelectedTargetProjectBasis")}</strong>
              {targets.length >= 2 && t("anotherTargetSDdIs")}
            </p>
            <GateDecisionPanel
              opportunityId={projectId}
              gates={["dd"]}
              entityType="project"
              showReview={false}
              nextStage={{ label: t("s10InvestmentStructureDesign"), href: `/projects/${projectId}/deal-structure` }}
            />
          </div>
        )}
          </>
        )}

        {waiverDlg && (
          <WaiverDialog
            dlg={waiverDlg}
            projectId={projectId}
            targetId={scopeParam}
            busy={busy}
            onLink={(id) => void judgeWaived(id)}
            onClose={() => setWaiverDlg(null)}
            onRequested={() => { setWaiverDlg(null); toast(t("waiverRequestRegisteredOnceApproved")); }}
          />
        )}
        {confirmDialog}
        {naDlg && (
          <NaReasonDialog
            label={naDlg.label}
            busy={busy}
            onClose={() => setNaDlg(null)}
            onSubmit={(note) => { const d = naDlg; setNaDlg(null); void judge(d.checklistId, d.itemId, "na", note); }}
          />
        )}
        {openDlg && (
          <OpenDdDialog
            projectId={projectId}
            target={openDlg}
            onClose={() => setOpenDlg(null)}
            onOpened={(targetId) => {
              setOpenDlg(null);
              setViewTarget(targetId);
              setTab(0);
              load(targetId);
              toast(t("openedDdRecordedAsComparison"));
            }}
          />
        )}
      </StageFrame>
</>
  );
}

/** Proposer label: human proposals show the person, agent proposals the agent, neither shows an explicit "no record" text. */
function proposerLabel(c: { proposed_by_agent: string | null; proposed_by_user: string | null }, tr: TranslatorFn): string {
  if (c.proposed_by_agent) return c.proposed_by_agent;
  if (c.proposed_by_user) return tr("stages.s9.stage.proposedP1", { p1: c.proposed_by_user }); // INTERIM-WORDING
  return tr("stages.s9.stage.noProposerRecord"); // INTERIM-WORDING
}
const SELF_APPROVAL_HINT_KEY = "stages.s9.stage.theProposerCannotApproveIt"; // INTERIM-WORDING

/** Code badge (text + icon, never colour only) with the reading / reason / replacement pointer the overlay gives, rendered as given. */
function ScopeNote({ sc, brownfield = false }: { sc: WsItemScope; brownfield?: boolean }) {const t = useTranslations("stages.s9.stage"); const tc = useTranslations("common");
  // Brownfield: a plain "A" row (as written, nothing special) carries no badge; only R / X / N and fail-closed rows do.
  if (brownfield && sc.code === "A" && sc.rule !== "fail_closed") return null;
  const m = brownfield ? bfCodeMeta(sc) : codeMeta(sc);
  const fallbackNote = sc.fallback === "replacement_not_judged" ? t("judgingThisItemBecauseIts") : null; // INTERIM-WORDING
  return (
    <span className="block mt-1 text-[length:var(--fs-caption)]" data-testid="dd-scope-note" data-code={sc.code}>
      <span className="status-chip status-not-started" title={m.hint}><span aria-hidden="true">{m.icon} </span>{m.label}</span>
      {m.ruleText && <span className="ml-1 text-[color:var(--muted-fg)]">{m.ruleText}</span>}
      {sc.code === "R" && sc.reading && <span className="block text-[color:var(--muted-fg)]">{brownfield ? t("howToRead") : t("greenfieldInterpretation")}: {sc.reading}</span>}
      {sc.code === "N" && !sc.judgeable && <span className="block text-[color:var(--muted-fg)]">{t("exclusionReason")} {sc.reason ?? tc("noReason")} {t("notAJudgementSubject")}</span>}
      {sc.code === "X" && sc.replaced_by.map((p) => <span key={`${p.checklist_id}:${p.item_id}`} className="block text-[color:var(--muted-fg)]">{brownfield ? t("substituteItems") : t("substitute")}: {pointerText(p)}</span>)}
      {sc.code === "X" && replacementUndecided(sc) && <span className="block text-[color:var(--muted-fg)]" data-testid="dd-replaced-pending">{REPLACED_PENDING_NOTE}</span>}
      {fallbackNote && <span className="block text-[color:var(--muted-fg)]">{fallbackNote}</span>}
    </span>
  );
}

/** Per-row waiver dialog: link an existing active waiver, or request a new one prefilled with the item. */
function WaiverDialog({ dlg, projectId, targetId, busy, onLink, onClose, onRequested }: {
  dlg: { checklistId: string; itemId: string; label: string; active: Array<{ id: string; clause_ref: string; governance_doc_id: string; expires_at: string }>; docs: Array<{ id: string; layer: string; key: string; title: string }> };
  projectId: string;
  targetId: string | null;
  busy: boolean;
  onLink: (waiverId: string) => void;
  onClose: () => void;
  onRequested: () => void;
}) {const t = useTranslations("stages.s9.stage");
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label={t("waiverRequestAndLink2")} style={{ maxWidth: "40rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[1rem] font-semibold mb-1">{t("waiverRequestAndLink3")}</h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
          {t("targetItems")} {dlg.label}{t("aWaivedJudgementRequiresAn")}
        </p>
        <h4 className="text-[length:var(--fs-body)] mb-1">{t("linkAnApprovedWaiver")}</h4>
        {dlg.active.length === 0 ? (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">{t("noActiveWaiverToLink")}</p>
        ) : (
          <ul className="space-y-2 mb-3">
            {dlg.active.map((w) => (
              <li key={w.id}>
                <button type="button" className="btn-ghost btn-sm w-full text-left" disabled={busy} onClick={() => onLink(w.id)}>
                  ⚖ {w.governance_doc_id} {w.clause_ref} {t("expiry")} {w.expires_at.slice(0, 10)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <h4 className="text-[length:var(--fs-body)] mb-1">{t("newWaiverRequest")}</h4>
        <WaiverRequestForm projectId={projectId} docs={dlg.docs} prefill={{ clause: `${dlg.checklistId} ${dlg.itemId}`, checklist_id: dlg.checklistId, item_id: dlg.itemId }} targetId={targetId} onDone={onRequested} onCancel={onClose} />
      </div>
    </div>
  );
}

/** `DD 열기` dialog (ADR-0157): a human opens comparison DD on a non-selected shortlisted target with a required rationale. */
function OpenDdDialog({ projectId, target, onClose, onOpened }: {
  projectId: string;
  target: { targetId: string; name: string };
  onClose: () => void;
  onOpened: (targetId: string) => void;
}) {const t = useTranslations("stages.s9.stage"); const tc = useTranslations("common");
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [rationale, setRationale] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = rationale.trim().length === 0;
  async function submit() {
    if (saving || missing) return;
    setSaving(true); setError(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/dd/targets`, { target_id: target.targetId, rationale: rationale.trim() });
      onOpened(target.targetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failedToOpenDd"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="dd-open-title" style={{ maxWidth: "36rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 id="dd-open-title" className="text-[1rem] font-semibold mb-1">{t("openDd2")} {target.name}</h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
          {t("addingDdToATarget")}
        </p>
        <label className="text-[length:var(--fs-caption)] block" htmlFor="dd-open-rationale">
          {t("evidenceForOpeningDdRequired")}
        </label>
        <textarea
          id="dd-open-rationale"
          className="sizing-new-input mt-1 w-full"
          rows={4}
          value={rationale}
          maxLength={4000}
          required
          aria-required="true"
          aria-describedby="dd-open-error"
          onChange={(e) => setRationale(e.target.value)}
          placeholder={t("whyDdThisTargetAs")}
        />
        <p id="dd-open-error" role="alert" aria-live="assertive" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1 min-h-[1.25rem]">
          {error ? `✕ ${error}` : ""}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
          {missing && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("evidenceIsRequiredToOpen")}</span>}
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{tc("cancel")}</button>
          <button type="button" className="btn-premium btn-sm" disabled={saving || missing} onClick={() => void submit()}>
            {saving ? t("opening") : t("openDd3")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Reason dialog for `na` on a checklist whose applicability the sub-track rule decided (no silent drops). */
function NaReasonDialog({ label, busy, onClose, onSubmit }: { label: string; busy: boolean; onClose: () => void; onSubmit: (note: string) => void }) {const t = useTranslations("stages.s9.stage"); const tc = useTranslations("common");
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const problem = validateNaReason(note);
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="dd-na-title" style={{ maxWidth: "36rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 id="dd-na-title" className="text-[1rem] font-semibold mb-1">{t("reason")}</h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
          {t("targetItems2")} {label}{t("whetherThisItemAppliesIs")}
        </p>
        <label className="text-[length:var(--fs-caption)] block" htmlFor="dd-na-reason">{t("reasonRequired")}</label>
        <textarea
          id="dd-na-reason"
          className="sizing-new-input mt-1 w-full"
          rows={3}
          value={note}
          maxLength={2000}
          required
          aria-required="true"
          aria-invalid={touched && !!problem}
          aria-describedby="dd-na-error"
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("whyThisItemDoesNot")}
        />
        <p id="dd-na-error" role="alert" aria-live="assertive" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1 min-h-[1.25rem]">
          {touched && problem ? `✕ ${problem}` : ""}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{tc("cancel")}</button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => { setTouched(true); if (!problem) onSubmit(note.trim()); }}>
            {t("recordAsNotApplicable")}
          </button>
        </div>
      </div>
    </div>
  );
}
