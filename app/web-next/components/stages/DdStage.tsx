"use client";

// S9 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/dd 페이지와
// /deals/[id]/s9 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.

import { DD_DOMAIN_LABEL, FINDING_CATEGORY_LABEL } from "../../lib/labels.ts";
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
import { GF_DD_STEP_LABEL } from "../../lib/labels.ts";
import { useConfirm } from "../crud.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { ReviewBadgeChip } from "../ReviewBadge.tsx";
import { DRAFT_AI_MARKER, reviewBadge, type ReviewStatus } from "../../lib/checklist-review-status.ts";
import TargetSelector, { type AnalysisTarget } from "../TargetSelector.tsx";

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
const STATE_META: Record<string, { icon: string; label: string; cls: string }> = {
  pending: { icon: "○", label: "판정 대기", cls: "status-not-started" },
  pass: { icon: "✓", label: "충족", cls: "status-green" },
  fail: { icon: "✕", label: "미충족", cls: "status-red" },
  na: { icon: "—", label: "해당 없음", cls: "status-not-started" },
  waived: { icon: "⚖", label: "Waived", cls: "status-amber" },
};

function stateMeta(status: string | undefined) {
  return STATE_META[status ?? "pending"] ?? { icon: "?", label: status ?? "unknown", cls: "status-not-started" };
}

const DOMAIN_LABEL: Record<string, string> = DD_DOMAIN_LABEL;


export function DdStage({ projectId }: { projectId: string }) {
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
      .catch((e) => setError(e instanceof Error ? e.message : "실사 데이터를 불러오지 못했습니다."));
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
      setNotice("추가 실사 도메인(재무·인사·시장·자금조달 계획)을 판정에 반영합니다 — 기록되었습니다.");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "반영 설정에 실패했습니다.");
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
    .map((t) => ({
      targetId: t.target_id,
      name: t.name,
      // The selector's "no company data" hint is a financial-analysis concern; DD has no such limit.
      companyId: t.target_id,
      isBound: t.is_selected,
      note: t.is_selected ? undefined : t.opened ? "비교 근거" : "DD 미개설",
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
        `산업 맞춤 제안 ${regenerate ? "재생성" : "생성"} 완료 (제안 ${r.data.proposedCount}건) — 제안 상태로만 기록되었습니다. 승인 전까지 완료 기준에 반영되지 않습니다.`,
      );
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "산업 맞춤 제안 생성 실패");
    } finally {
      setBusy(false);
    }
  }

  function review(item: CustomItem, decision: "approved" | "rejected") {
    confirm(
      decision === "approved" ? "산업 맞춤 항목 승인" : "산업 맞춤 항목 기각",
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
                ? "승인됨 — 항목이 판정 대상 체크리스트에 편입되었습니다 (판정 대기 상태)."
                : "기각됨 — 항목이 판정 대상에서 제외되었습니다.",
            );
            reload();
          } catch (e) {
            setError((e as { code?: string } | null)?.code === "second_person_required" ? "맞춤 항목을 제안한 사람은 직접 승인/기각할 수 없습니다. 다른 사람이 검토해야 합니다." /* INTERIM-WORDING */ : e instanceof Error ? e.message : "승인/기각 실패");
          } finally {
            setBusy(false);
          }
        })();
      },
      {
        body:
          decision === "approved"
            ? "이 항목을 판정 대상 체크리스트에 편입합니다. 승인은 인간 결정이며, 승인된 항목은 S9 완료 기준에 포함됩니다."
            : "이 제안을 기각합니다. 기각된 항목은 완료 기준에 반영되지 않습니다.",
        confirmLabel: decision === "approved" ? "승인" : "기각",
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
      setNotice("판정이 기록되었습니다.");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "판정 기록 실패");
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
      .catch((e) => setError(e instanceof Error ? e.message : "waiver 목록 조회 실패"));
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
      setNotice("waiver가 연결된 판정(waived)이 기록되었습니다.");
      toast("면제(waived) 판정을 기록했습니다.");
      setWaiverDlg(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "waived 판정 기록 실패");
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
      setError("가치 영향은 정수(백만원)로 입력하세요."); return;
    }
    setBusy(true); setError(null);
    try {
      await api.put(`/api/projects/${encodeURIComponent(projectId)}/dd/findings`, {
        finding_id: fid, description: findingDraft.description, value_impact: valueImpact, evidence_ref: findingDraft.evidence_ref,
      });
      setNotice("조사내역을 정정했습니다 — 반영 경로는 동일합니다 (게이트 근거 · S10 입력 · 투자심사 패키지).");
      setEditingFinding(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "조사내역 정정 실패");
    } finally {
      setBusy(false);
    }
  }

  function removeFinding(fid: string) {
    confirm("조사내역 삭제", () => {
      void (async () => {
        setBusy(true); setError(null);
        try {
          await api.delete(`/api/projects/${encodeURIComponent(projectId)}/dd/findings`, { finding_id: fid });
          setNotice("조사내역을 삭제했습니다 — 감사 로그에 기록됩니다.");
          reload();
        } catch (e) {
          setError(e instanceof Error ? e.message : "조사내역 삭제 실패");
        } finally { setBusy(false); }
      })();
    }, { body: "삭제한 조사내역은 S10 추천 입력과 투자심사 패키지에서도 제외됩니다 — 감사 로그에는 기록이 남습니다.", tone: "danger" });
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
  const domainTabs = (data?.domains ?? []).map((d, i) => ({ key: String(i), label: tabLabel(data?.greenfield_scope, d) }));
  const tabItems = data
    ? [
        ...domainTabs,
        ...(ws ? [{ key: String(data.domains.length), label: planReadinessLabel(data.greenfield_scope) }] : []),
        ...(isBrownfield ? [{ key: String(capTabIdx), label: "필요 역량 검증" }] : []),
        { key: String(decisionTabIdx), label: "의사결정" },
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
        heading={s9Heading(data?.greenfield_scope)}
        railSlot={<StageTabs projectId={projectId} />}
      >
        <GateDecisionJump gate="dd" inline beforeJump={() => { if (data) setTab(decisionTabIdx); }} />
        <ReviewBuckets entityType="project" entityId={projectId} gates={["dd"]} artifacts={stageArtifactTabs("S9")} />
        {data && (
          <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="dd-subject-header">
            {targets.length === 0 ? (
              <p className="text-[length:var(--fs-body)]">
                <strong>실사 대상:</strong> 지정된 대상 회사가 없습니다 — Green Field이거나 최종 후보 목록 대상이 없는 프로젝트라 프로젝트 기준으로 실사합니다.
              </p>
            ) : !selectedTarget ? (
              <p className="text-[length:var(--fs-body)]">
                <strong>실사 대상:</strong> 아직 선정되지 않음 — S8에서 대상을 선정하면 선정 대상이 여기에 표시되고 게이트 기준이 됩니다.
              </p>
            ) : (
              <>
                <p className="text-[length:var(--fs-body)]">
                  <strong>실사 대상:</strong> <strong data-testid="dd-subject-name">{(viewSummary ?? selectedTarget).name}</strong>
                </p>
                {viewSummary && viewSummary.target_id !== selectedTarget.target_id ? (
                  <span className="status-chip status-amber">비교 근거</span>
                ) : (
                  <span className="status-chip status-green">✓ S8 선정 대상 · 게이트 기준</span>
                )}
              </>
            )}
          </div>
        )}

        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          적용 체크리스트의 모든 항목이 판정되고 필수 미충족이 0건이어야 S9이 완료됩니다 (flow.spec v2.0.0).
          {data && (
            <>
              {countLocation(data.greenfield_scope) === "panel" ? null : <>{" — "}
              <span className={`status-chip ${data.completion.pending === 0 && data.completion.unassessed === 0 && data.completion.mandatoryUnmet === 0 && data.completion.total > 0 ? "status-green" : "status-amber"}`}>
                {data.completion.total === 0 && data.completion.unassessed === 0
                  ? "판정 기록 없음"
                  : data.completion.pending === 0 && data.completion.unassessed === 0 && data.completion.mandatoryUnmet === 0
                    ? "✓ 판정 완료 · 필수 미충족 0건"
                    : `○ 대기 ${data.completion.pending}건 · 미판정 ${data.completion.unassessed}건 · ✕ 필수 미충족 ${data.completion.mandatoryUnmet}건`}
              </span>
              {headerCount && (
                <span className="ml-2 status-chip status-not-started" role="status" aria-live="polite" aria-atomic="true" data-testid="dd-header-judged">
                  {headerCount.text}<span className="sr-only">{countAnnouncement(headerCount)}</span>
                </span>
              )}</>}
            </>
          )}
          <span className="ml-2 status-chip status-not-started">에이전트 제안 ≠ 승인 — 승인은 사람의 행위입니다</span>
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
          <section className="market-section sizing-step mb-3" aria-label="실사 조사 도구" data-testid="dd-tools">
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">
              <span className="sizing-step-badge" aria-hidden="true">🧰</span> 실사 조사 도구 — 실사 산물을 기록하는 화면
            </h3>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              이 화면들의 기록은 S9 실사 체크리스트(ma-04~08 · cdd-07)와 리스크 히트맵·투자심의 자료로 흘러갑니다.
              {toolsGf
                ? " Green Field는 고객 CoC·경영진 보상(M&A 실사 항목)이 도메인 범위 밖이라 인터뷰·리스크 히트맵만 표시됩니다."
                : " Brown Field는 고객 CoC·경영진 보상 실사도 포함됩니다."}
            </p>
            <ul className="grid gap-2 md:grid-cols-4 list-none p-0 m-0">
              <li>
                <Link href={`/projects/${projectId}/interviews`} className="card block" data-testid="dd-tool-interviews">
                  <strong>전문가 인터뷰 · 채널 체크</strong>
                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">cdd-07 — 주장당 독립 출처 2개 이상</span>
                  <span className={`status-chip ${data.tool_counts.interviews.pending_claims > 0 ? "status-amber" : "status-green"} mt-1`}>인터뷰 {data.tool_counts.interviews.total}건 · 삼각검증 {data.tool_counts.interviews.triangulated_claims} / 미충족 {data.tool_counts.interviews.pending_claims}</span>
                </Link>
              </li>
              <li>
                <Link href={`/projects/${projectId}/risk-heatmap`} className="card block" data-testid="dd-tool-heatmap">
                  <strong>리스크 히트맵</strong>
                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">ADR-0122 — DD·CoC·클로백·커버넌트 통합 판정</span>
                  <span className={`status-chip ${data.tool_counts.heatmap.high > 0 ? "status-red" : "status-green"} mt-1`}>항목 {data.tool_counts.heatmap.total}건 · 높음 {data.tool_counts.heatmap.high}건</span>
                </Link>
              </li>
              {!toolsGf && (
              <li>
                <Link href={`/projects/${projectId}/customer-coc`} className="card block" data-testid="dd-tool-coc">
                  <strong>고객 집중 · 지위 변동(CoC)</strong>
                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">ma-07/08 — 계약 스캔 · 집중도 30% 자동 플래그</span>
                  <span className="status-chip status-not-started mt-1">기록 {data.tool_counts.contracts.total}건 · 플래그 {data.tool_counts.contracts.plotted}건</span>
                </Link>
              </li>
              )}
              {!toolsGf && (
              <li>
                <Link href={`/projects/${projectId}/comp-parity`} className="card block" data-testid="dd-tool-comp">
                  <strong>경영진 보상 · 임금 형평</strong>
                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">ma-04~06 · hdd — CoC 트리거 보상 · k≥3 집계</span>
                  <span className="status-chip status-not-started mt-1">패키지 {data.tool_counts.compensation.packages}건 · 형평 {data.tool_counts.compensation.parity_rows}건</span>
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
              boundLabel="선정 대상"
              ariaLabel="DD 대상 선택"
            />
            {comparing && (
              <p role="note" className="status-chip status-amber mt-2" data-testid="dd-comparison-banner">
                <span aria-hidden="true">⚠ </span>비교 근거 — 게이트 판정에 반영되지 않습니다
              </p>
            )}
          </div>
        )}

        {comparisonRows.length >= 2 && (
          <section className="market-section sizing-step mb-3" aria-label="비교 근거">
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">비교 근거</h3>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              열린 대상별 DD 현황입니다. 합격·불합격 표시 없이 아직 확인하지 못한 항목 수를 그대로 보여주며, 선정 대상 외 행은 게이트 판정에 반영되지 않습니다.
            </p>
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-56" aria-label="대상별 DD 비교 근거">
                <caption className="sr-only">열린 대상별 DD 비교 근거 — 전체 항목, 미판정, 판정 대기, 필수 미충족, 가치 영향 조사내역</caption>
                <ColGroup widths={DD_COMPARE_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">대상</th>
                    <th scope="col">구분</th>
                    <th scope="col" className="col-num">전체 항목</th>
                    <th scope="col" className="col-num">미판정</th>
                    <th scope="col" className="col-num">판정 대기</th>
                    <th scope="col" className="col-num">필수 미충족</th>
                    <th scope="col" className="col-num">가치 영향 조사내역</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((t) => (
                    <tr key={t.target_id}>
                      <th scope="row" data-label="대상">{t.name}</th>
                      <td data-label="구분">{t.is_selected ? "선정 대상 (게이트 판정)" : "비교 근거"}</td>
                      <td data-label="전체 항목" className="col-num tabular-nums">{t.total}</td>
                      <td data-label="미판정" className="col-num tabular-nums">{t.unassessed}</td>
                      <td data-label="판정 대기" className="col-num tabular-nums">{t.pending}</td>
                      <td data-label="필수 미충족" className="col-num tabular-nums">{t.mandatory_unmet}</td>
                      <td data-label="가치 영향 조사내역" className="col-num tabular-nums">{t.findings_with_value_impact} / {t.findings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {viewNotOpened && viewSummary && (
          <section className="market-section sizing-step mb-3" aria-label="DD 미개설 대상">
            <p className="text-[length:var(--fs-body)] mb-2">
              <strong>{viewSummary.name}</strong>: DD가 열리지 않은 대상입니다. 비교 근거로 DD를 열면 이 대상의 체크리스트 판정·맞춤 항목·조사내역·waiver가 따로 기록되며, 게이트 판정에는 반영되지 않습니다.
            </p>
            {canAct ? (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpenDlg({ targetId: viewSummary.target_id, name: viewSummary.name })}>
                DD 열기
              </button>
            ) : (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">DD 열기는 analyst 역할 이상의 사람만 할 수 있습니다.</p>
            )}
          </section>
        )}

        {canAct && !viewNotOpened && (
          <div className="mb-3">
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => {
              const hasProposed = (data?.domains ?? []).some((d) => d.custom.some((c) => c.status === "proposed"));
              if (hasProposed) {
                confirm(
                  "산업 맞춤 제안 재생성",
                  () => { void tailor(true); },
                  { body: "기존 대기 중인 제안(미승인 AI 초안)을 삭제하고 새로 생성합니다 — 승인·기각된 항목은 그대로 유지됩니다." },
                );
              } else {
                void tailor(false);
              }
            }}>
              {busy ? "생성 중..." : "산업 맞춤 제안 생성 · 다시 생성 (commercial-dd-agent · technical-dd-agent · legal-counsel)"}
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
              label="DD 체크리스트 도메인"
              active={String(tab)}
              onSelect={(key) => setTab(Number(key))}
              tabs={tabItems}
            />
            {planTab && ws && (
              <section className="market-section sizing-step mt-3" aria-label="계획 준비 상태" data-testid="dd-plan-readiness">
                <h3 className="sizing-step-title text-[length:var(--fs-body)]">{planReadinessLabel(data?.greenfield_scope)}</h3>
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                  체크리스트 항목이 없는 단계(4·5·6)의 상태입니다. 완료 집계에 들어가지 않으며, 판정 버튼도 없습니다. {/* INTERIM-WORDING */}
                </p>
                <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                  <table className="data-table table-fixed-pct tmin-40" aria-label="계획 준비 상태">
                    <caption className="sr-only">단계 4·5·6의 상태 — 완료 집계에 포함되지 않음</caption>
                    <ColGroup widths={PLAN_COL_PCT} />
                    <thead>
                      <tr><th scope="col">단계</th><th scope="col">범위</th><th scope="col">상태</th><th scope="col">근거·연결</th></tr>
                    </thead>
                    <tbody>
                      {ws.plan_readiness.map((r) => {
                        const st = PLAN_STATUS_TEXT[r.status];
                        const href = planArtefactHref(r.step);
                        return (
                          <tr key={r.step}>
                            <th scope="row" data-label="단계" className="text-left">{r.step}단계 {GF_DD_STEP_LABEL[r.step] ?? r.purpose}</th>
                            <td data-label="범위">{r.in_scope ? "✓ 범위 안" : "— 범위 밖"}{r.reason && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{r.reason}</span>}</td>
                            <td data-label="상태"><span className={`status-chip ${r.status === "recorded" ? "status-green" : "status-not-started"}`}>{st.icon} {st.text}</span></td>
                            <td data-label="근거·연결">
                              {r.detail && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{r.detail}</span>}
                              {r.artefact && <span className="block text-[length:var(--fs-caption)]">{r.artefact}</span>}
                              {href && <a className="text-[length:var(--fs-caption)]" href={href}>해당 위치로 이동</a>}
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
                {tabLabel(data?.greenfield_scope, domain)}
                {(ws || bf) && (
                  <span className="ml-2 text-[length:var(--fs-caption)] font-normal text-[color:var(--muted-fg)]" role="status" aria-live="polite" data-testid="dd-tab-count">
                    이 탭에서 {counts.judged} / {counts.judgeable} 판정
                  </span>
                )}
              </h3>
              {stepTags.length > 0 && (
                <ul className="flex flex-wrap gap-2 mt-1" aria-label="이 탭이 맡는 절차 단계" data-testid="dd-step-tags">
                  {stepTags.map((t) => (
                    <li key={t.step} className={`status-chip ${t.inScope ? "status-green" : "status-not-started"}`} title={t.reason ?? undefined}>
                      <span aria-hidden="true">{t.icon} </span>{t.step}단계 {t.label} — {t.stateText}{t.reason ? ` (${t.reason})` : ""}
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
                    이 도메인들을 이 프로젝트의 판정에 반영할 수 있습니다 — 근거를 기재하고 사람이 확정하세요 (게이트 규칙 변경은 기록으로 남습니다).
                  </label>
                  <textarea
                    id="dd-adopt-rationale"
                    className="sizing-new-input sizing-new-input-sm w-full"
                    rows={2}
                    value={adoptRationale}
                    placeholder="예: 본 딜은 컷오프 이후 재무·시장 실사를 실질 수행 — 반영 확정 (담당: 이름)"
                    onChange={(e) => setAdoptRationale(e.target.value)}
                  />
                  <button type="button" className="btn-ghost btn-sm justify-self-start" disabled={adoptBusy || adoptRationale.trim().length < 10} onClick={() => void submitAdopt()} data-testid="dd-adopt-submit">
                    {adoptBusy ? "반영 중..." : "추가 실사 도메인을 판정에 반영 (사람 확정)"}
                  </button>
                </div>
              )}
              {domain.domain === "hr" && ws && (
                <p role="note" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2" data-testid="dd-hr-tab-hint">
                  ⓘ 인력/조직 계획 탭은 본래 기존 사업 인수(Brown Field) 실사의 항목으로, 인수 후 조직·핵심인력 계획을 검증합니다. 신규 사업 프로젝트에서는 인력 계획의 검증 상태를 보여 주는 참고 탭이며, 프로젝트가 작업 공간 범위에 들어온 경우에만 완료 건수와 게이트 판정에 반영됩니다.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label="항목 필터">
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">보기:</span>
              {([["all", "전체"], ["pending", "판정 대기만"], ["fail", "미충족만"]] as const).map(([k, label]) => (
                <button key={k} type="button" className="control-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
              ))}
              {!canAct && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">판정 기록은 analyst 역할 이상만 할 수 있어 기록 버튼이 보이지 않습니다.</span>}
              {busy && <span role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">기록 중입니다 - 완료될 때까지 판정 버튼이 잠깁니다.</span>}
            </div>
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table dd-table table-fixed-pct tmin-48" aria-label={`${tabLabel(data?.greenfield_scope, domain)} 체크리스트`}>
              <caption className="sr-only">{tabLabel(data?.greenfield_scope, domain)} 체크리스트 판정</caption>
              <ColGroup widths={rowCanAct ? DD_COL_PCT_ACT : DD_COL_PCT_READONLY} />
              <thead>
                <tr>
                  <th scope="col">항목</th>
                  <th scope="col">필수</th>
                  <th scope="col">판정</th>
                  {rowCanAct && <th scope="col">판정 기록</th>}
                </tr>
              </thead>
              <tbody>
                {split.judgeable.map((item) => {
                  const display = ddItemDisplay(item.state);
                  if (!matchesFilter(filter, display)) return null;
                  const meta = stateMeta(display.status);
                  const ko = koChecklistText(domain.checklistId, item.id, item.text);
                  return (
                    <tr key={item.id}>
                      <td data-label="항목">
                        {/* 2026-10-19 decider: the 검토 상태 chip left the row — the id carries
                            the full draft-AI tooltip, counsel-reviewed/confirmed keep their chips. */}
                        <span
                          className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums mr-1"
                          title={reviewBadge(item).status === "draft-AI" ? `검토 상태: ${DRAFT_AI_MARKER}` : undefined}
                        >
                          {item.id}
                        </span>
                        <span title={ko.translated ? item.text : undefined}>{ko.text}</span>
                        {item.state?.waiver_id && <span className="status-chip status-amber ml-1" title={`waiver ${item.state.waiver_id}`}>⚖ waiver</span>}
                        {reviewBadge(item).status !== "draft-AI" && <ReviewBadgeChip item={item} />}
                        {item.scope && <ScopeNote sc={item.scope} brownfield={!!bf} />}
                      </td>
                      <td data-label="필수">{item.mandatory ? "필수" : "선택"}</td>
                      <td data-label="판정">
                        <span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span>
                        <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{display.judged ? (display.byline ? `판정: ${display.byline}` : "판정됨") : "아직 판정하지 않음"}</span>
                      </td>
                      {rowCanAct && (
                        <td data-label="판정 기록">
                          <span className="actions-row dd-actions">
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title="충족 판정" aria-label={`${ko.text} 충족 판정`} onClick={() => void judge(domain.checklistId, item.id, "pass")}>✓ 충족</button>
                            <button type="button" className="btn-danger btn-sm" disabled={busy} title="미충족 판정 (필수 항목은 waiver 없이 S9 완료 불가)" aria-label={`${ko.text} 미충족 판정`} onClick={() => void judge(domain.checklistId, item.id, "fail")}>✕ 미충족</button>
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title="해당 없음 판정" aria-label={`${ko.text} 해당 없음 판정`} onClick={() => requestNa(domain.checklistId, item.id, `${item.id} ${ko.text}`)}>— 해당없음</button>
                            {item.waiver_eligible ? (
                              <button type="button" className="btn-ghost btn-sm" disabled={busy} aria-label={`${ko.text} 면제 요청·연결`} onClick={() => openWaiverDialog(domain.checklistId, item.id, `${item.id} ${ko.text}`)}>
                                ⚖ 면제 요청·연결
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
                  const meta = stateMeta(display.status);
                  return (
                    <tr key={c.id}>
                      <td data-label="항목">
                        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums mr-1">{DOMAIN_LABEL[c.domain] ?? c.domain}-custom</span>
                        {c.item_label}
                        <span className="status-chip status-not-started ml-1" title="산업 맞춤 제안에서 승인된 항목">맞춤</span>
                        {c.state?.waiver_id && <span className="status-chip status-amber ml-1" title={`waiver ${c.state.waiver_id}`}>⚖ waiver</span>}
                      </td>
                      <td data-label="필수">필수 (승인 편입)</td>
                      <td data-label="판정">
                        <span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span>
                        <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{display.judged ? (display.byline ? `판정: ${display.byline}` : "판정됨") : "아직 판정하지 않음"}</span>
                      </td>
                      {rowCanAct && (
                        <td data-label="판정 기록">
                          <span className="actions-row dd-actions">
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title="충족 판정" aria-label={`${c.item_label} 충족 판정`} onClick={() => void judge(`custom:${c.domain}`, c.id, "pass")}>✓ 충족</button>
                            <button type="button" className="btn-danger btn-sm" disabled={busy} title="미충족 판정 (필수 항목은 waiver 없이 S9 완료 불가)" aria-label={`${c.item_label} 미충족 판정`} onClick={() => void judge(`custom:${c.domain}`, c.id, "fail")}>✕ 미충족</button>
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title="해당 없음 판정" aria-label={`${c.item_label} 해당 없음 판정`} onClick={() => requestNa(`custom:${c.domain}`, c.id, `${c.id} ${c.item_label}`)}>— 해당없음</button>
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
                <summary className="cursor-pointer text-[length:var(--fs-body)]">트랙 규칙으로 제외된 항목 ({split.excluded.length}건) — 판정하지 않습니다</summary> {/* INTERIM-WORDING */}
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
                <summary className="cursor-pointer text-[length:var(--fs-body)]">이전 범위에서 판정됨 ({previousHere.length}건)</summary> {/* INTERIM-WORDING */}
                <ul className="sizing-note-list mt-2">
                  {previousHere.map((p) => (
                    <li key={p.item_id}>
                      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums mr-1">{p.item_id}</span>
                      {p.code === "X" ? "X 대체됨" : "N 해당 없음"} · 기록된 판정: {statusText(p.status)}
                      {p.assessed_by && ` (${p.assessed_by}${p.assessed_at ? ` · ${p.assessed_at.slice(0, 10)}` : ""})`}
                      {p.stays_unmet && <span className="status-chip status-red ml-1">✕ 미충족으로 남음 — 사람이 다시 판정하기 전까지</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <section className="market-section sizing-step mt-3" aria-label="산업 맞춤 제안">
              <h3 className="sizing-step-title text-[length:var(--fs-body)]">산업 맞춤 제안 (proposed)</h3>
              {domain.custom.filter((c) => c.status === "proposed").length === 0 && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">대기 중인 제안이 없습니다 — 에이전트 제안은 실사 체크리스트 수행 중 도착합니다.</p>
              )}
              <ul className="sizing-note-list">
                {domain.custom.filter((c) => c.status === "proposed").map((c) => (
                  <li key={c.id}>
                    {c.item_label}
                    <span className="ml-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={proposerLabel(c)}>
                      ({DOMAIN_LABEL[c.domain] ?? c.domain} · {proposerLabel(c)})
                    </span>
                    {c.rationale && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">근거: {c.rationale}</span>}
                    {c.source_url ? (
                      <a className="text-[length:var(--fs-caption)]" href={c.source_url} target="_blank" rel="noreferrer">
                        출처 ({c.source_reliability ?? "?"}): {c.source_url}
                      </a>
                    ) : (
                      <span className="status-chip status-amber ml-0" title="이 제안은 외부 출처가 확인되지 않았습니다 (신뢰도 C — 최저 등급)">
                        출처 없음 (C)
                      </span>
                    )}
                    {canAct && c.is_proposer && (
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="dd-self-approval-hint">{SELF_APPROVAL_HINT}</span>
                    )}
                    {canAct && !c.is_proposer && (
                      <span className="actions-row ml-2">
                        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => review(c, "approved")}>승인</button>
                        <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => review(c, "rejected")}>기각</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            </>)}


            <section className="market-section sizing-step mt-3" aria-label="조사내역 (dd_finding)" id="dd-findings">
              <h3 className="sizing-step-title text-[length:var(--fs-body)]">조사내역 (dd_finding)</h3>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="dd-findings-flow">
                반영 경로: ① 아래 판정 기록과 함께 <b>dd 게이트 판정 근거</b>가 되고, ② 가치 영향이 기재된 최근 6건은{" "}
                <b>S10 투자구조 추천</b> 생성 입력으로 자동 전달되며, ③ S11 <b>투자심사 패키지</b>에도 포함됩니다. 이 탭에서의 추가 편집은 없습니다 — 기록이 곧 반영입니다.
              </p>
              {(data?.findings.length ?? 0) === 0 && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">등록된 조사내역이 없습니다 — 실사 수행 중 발견한 사실을 상단 폼에서 기록하세요.</p>
              )}
              <ul className="sizing-note-list">
                {(data?.findings ?? []).map((f) => (
                  <li key={f.id}>
                    <strong>{FINDING_CATEGORY_LABEL[f.category] ?? f.category}</strong>:{" "}
                    {editingFinding === f.id ? (
                      <span className="inline-flex flex-wrap gap-1 items-center align-middle">
                        <input aria-label="발견 내용 수정" className="sizing-new-input sizing-new-input-sm" style={{ width: "24rem" }} value={findingDraft.description} onChange={(e) => setFindingDraft((d) => ({ ...d, description: e.target.value }))} />
                        <input aria-label="가치 영향 수정 (백만원)" className="sizing-new-input sizing-new-input-sm" style={{ width: "8rem" }} placeholder="가치 영향" value={findingDraft.value_impact} onChange={(e) => setFindingDraft((d) => ({ ...d, value_impact: e.target.value }))} />
                        <input aria-label="증적 참조 수정" className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} placeholder="증적" value={findingDraft.evidence_ref} onChange={(e) => setFindingDraft((d) => ({ ...d, evidence_ref: e.target.value }))} />
                        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void saveFinding(f.id)}>저장</button>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingFinding(null)}>취소</button>
                      </span>
                    ) : (
                      <>
                        {f.description}
                        {f.value_impact != null && <span className="status-chip status-info ml-1 tabular-nums" title="S10 투자구조 추천 입력으로 전달됩니다">가치 영향 {f.value_impact} → S10</span>}
                        {f.evidence_ref && <span className="ml-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title="증적 참조">증적: {f.evidence_ref}</span>}
                        {canAct && (
                          <span className="actions-row ml-2 align-middle">
                            <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditingFinding(f.id); setFindingDraft({ description: f.description, value_impact: f.value_impact != null ? String(f.value_impact) : "", evidence_ref: f.evidence_ref ?? "" }); }}>정정</button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => removeFinding(f.id)}>삭제</button>
                          </span>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {(data?.findings.length ?? 0) > 6 && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" role="note">
                  ⓘ 조사내역이 {data?.findings.length}건입니다 — S10 추천 입력에는 최근 6건만 자동 전달됩니다. 나머지는 게이트 판정 근거와 투자심사 패키지에 포함됩니다.
                </p>
              )}
            </section>
                    {decisionTab && (
          <div className="mt-4">
            {capSummary && (
              <div className="market-section sizing-step mb-3" aria-label="필요 역량 판정 요약" data-testid="capability-dd-summary">
                <h3 className="sizing-step-title text-[length:var(--fs-body)]">필요 역량 판정 요약 (capability-dd)</h3>
                <p className="flex flex-wrap gap-2 items-center">
                  <span className="status-chip status-green">해소 {capSummary.resolved}</span>
                  <span className="status-chip status-amber">부분 해소 {capSummary.partial}</span>
                  <span className={`status-chip ${capSummary.unresolved > 0 ? "status-red" : "status-not-started"}`}>미해소 {capSummary.unresolved}</span>
                  {capSummary.pending > 0 && <span className="status-chip status-amber">미판정 {capSummary.pending}</span>}
                  {capSummary.unresolved + capSummary.partial > 0 && (
                    <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      — 인수만으로 해소되지 않는 역량입니다. 필요 역량 검증 탭의 판정 근거와 함께 S10 검토 사항으로 확인하세요.
                    </span>
                  )}
                </p>
              </div>
            )}
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="dd-gate-subject">
              게이트 판정 대상: <strong>{selectedTarget?.name ?? "선정 대상 없음 (프로젝트 기준)"}</strong>
              {targets.length >= 2 && " — 다른 대상의 DD는 비교 근거이며 이 판정에 반영되지 않습니다."}
            </p>
            <GateDecisionPanel
              opportunityId={projectId}
              gates={["dd"]}
              entityType="project"
              showReview={false}
              nextStage={{ label: "S10 투자구조 설계", href: `/projects/${projectId}/deal-structure` }}
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
            onRequested={() => { setWaiverDlg(null); toast("면제 요청을 등록했습니다. 승인되면 이 항목에 연결할 수 있습니다."); }}
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
              toast("대상별 DD를 열었습니다. 비교 근거로만 기록됩니다.");
            }}
          />
        )}
      </StageFrame>
</>
  );
}

/** Proposer label: human proposals show the person, agent proposals the agent, neither shows an explicit "no record" text. */
function proposerLabel(c: { proposed_by_agent: string | null; proposed_by_user: string | null }): string {
  if (c.proposed_by_agent) return c.proposed_by_agent;
  if (c.proposed_by_user) return `제안: ${c.proposed_by_user}`; // INTERIM-WORDING
  return "제안자 기록 없음"; // INTERIM-WORDING
}
const SELF_APPROVAL_HINT = "제안한 사람은 직접 승인할 수 없습니다 — 다른 사람이 검토해야 합니다"; // INTERIM-WORDING

/** Code badge (text + icon, never colour only) with the reading / reason / replacement pointer the overlay gives, rendered as given. */
function ScopeNote({ sc, brownfield = false }: { sc: WsItemScope; brownfield?: boolean }) {
  // Brownfield: a plain "A" row (as written, nothing special) carries no badge; only R / X / N and fail-closed rows do.
  if (brownfield && sc.code === "A" && sc.rule !== "fail_closed") return null;
  const m = brownfield ? bfCodeMeta(sc) : codeMeta(sc);
  const fallbackNote = sc.fallback === "replacement_not_judged" ? "대체 항목이 아직 판정되지 않아 이 항목을 판정합니다." : null; // INTERIM-WORDING
  return (
    <span className="block mt-1 text-[length:var(--fs-caption)]" data-testid="dd-scope-note" data-code={sc.code}>
      <span className="status-chip status-not-started" title={m.hint}><span aria-hidden="true">{m.icon} </span>{m.label}</span>
      {m.ruleText && <span className="ml-1 text-[color:var(--muted-fg)]">{m.ruleText}</span>}
      {sc.code === "R" && sc.reading && <span className="block text-[color:var(--muted-fg)]">{brownfield ? "읽는 방법" : "그린필드 해석"}: {sc.reading}</span>}
      {sc.code === "N" && !sc.judgeable && <span className="block text-[color:var(--muted-fg)]">제외 사유: {sc.reason ?? "사유 없음"} — 판정 대상이 아닙니다</span>}
      {sc.code === "X" && sc.replaced_by.map((p) => <span key={`${p.checklist_id}:${p.item_id}`} className="block text-[color:var(--muted-fg)]">{brownfield ? "대체 항목" : "대체"}: {pointerText(p)}</span>)}
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
}) {
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label="면제 요청·연결" style={{ maxWidth: "40rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[1rem] font-semibold mb-1">면제 요청·연결</h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
          대상 항목: {dlg.label}. 면제(waived) 판정은 사유와 만료가 기록된 승인 waiver에만 가능합니다.
        </p>
        <h4 className="text-[length:var(--fs-body)] mb-1">이미 승인된 waiver 연결</h4>
        {dlg.active.length === 0 ? (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">연결할 수 있는 활성 waiver가 없습니다. 아래에서 새로 요청하세요 - 승인된 뒤에 연결할 수 있습니다.</p>
        ) : (
          <ul className="space-y-2 mb-3">
            {dlg.active.map((w) => (
              <li key={w.id}>
                <button type="button" className="btn-ghost btn-sm w-full text-left" disabled={busy} onClick={() => onLink(w.id)}>
                  ⚖ {w.governance_doc_id} {w.clause_ref} — 만료 {w.expires_at.slice(0, 10)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <h4 className="text-[length:var(--fs-body)] mb-1">새 waiver 요청</h4>
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
}) {
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
      setError(e instanceof Error ? e.message : "DD를 열지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="dd-open-title" style={{ maxWidth: "36rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 id="dd-open-title" className="text-[1rem] font-semibold mb-1">DD 열기 — {target.name}</h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
          선정 대상이 아닌 대상에 DD를 추가하면 체크리스트 판정, 맞춤 항목, 조사내역, waiver 작업이 대상마다 더해져 검토 비용이 늘어납니다.
          이 DD는 비교 근거로만 기록되며 게이트 판정에는 반영되지 않습니다. 근거는 감사 기록에 남습니다.
        </p>
        <label className="text-[length:var(--fs-caption)] block" htmlFor="dd-open-rationale">
          DD를 여는 근거 (필수)
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
          placeholder="왜 이 대상을 비교 근거로 실사해야 하는가"
        />
        <p id="dd-open-error" role="alert" aria-live="assertive" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1 min-h-[1.25rem]">
          {error ? `✕ ${error}` : ""}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
          {missing && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">근거를 입력해야 열 수 있습니다.</span>}
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-premium btn-sm" disabled={saving || missing} onClick={() => void submit()}>
            {saving ? "여는 중..." : "DD 열기"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Reason dialog for `na` on a checklist whose applicability the sub-track rule decided (no silent drops). */
function NaReasonDialog({ label, busy, onClose, onSubmit }: { label: string; busy: boolean; onClose: () => void; onSubmit: (note: string) => void }) {
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const problem = validateNaReason(note);
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="dd-na-title" style={{ maxWidth: "36rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3 id="dd-na-title" className="text-[1rem] font-semibold mb-1">해당 없음 사유</h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
          대상 항목: {label}. 이 항목은 세부 트랙 규칙으로 적용 여부가 정해지므로, 해당 없음 판정에는 사유가 필요하며 감사 기록에 남습니다.
        </p>
        <label className="text-[length:var(--fs-caption)] block" htmlFor="dd-na-reason">사유 (필수)</label>
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
          placeholder="왜 이 항목이 이 계획에 해당하지 않는가"
        />
        <p id="dd-na-error" role="alert" aria-live="assertive" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-1 min-h-[1.25rem]">
          {touched && problem ? `✕ ${problem}` : ""}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => { setTouched(true); if (!problem) onSubmit(note.trim()); }}>
            해당 없음으로 기록
          </button>
        </div>
      </div>
    </div>
  );
}
