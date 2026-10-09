"use client";

// S9 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/dd 페이지와
// /deals/[id]/s9 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.

import { DD_DOMAIN_LABEL } from "../../lib/labels.ts";
import { useCallback, useEffect, useState } from "react";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { StageTabs } from "../StageTabs.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { StageFrame } from "../StageFrame.tsx";
import { TabNav } from "../TabNav.tsx";
import { GateDecisionJump, GateDecisionPanel } from "../GateDecisionPanel.tsx";
import { WaiverPanel, WaiverRequestForm } from "../WaiverPanel.tsx";
import { koChecklistText, nonWaivableReason } from "../../lib/dd-checklist-ko.ts";
import { ddItemDisplay, matchesFilter, type ItemFilter } from "../../lib/dd-item-display.ts";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { useToast } from "../ui.tsx";
import { useConfirm } from "../crud.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import TargetSelector, { type AnalysisTarget } from "../TargetSelector.tsx";

// S9 실사·검증 — 표준 DD 체크리스트 판정 + 산업 맞춤 제안 승인 화면 (ADR-0099 §4).
// 표준 체크리스트 3개(commercial/technical/legal) 탭 + 산업 맞춤 제안 패널
// + dd_finding 목록 + GateDecisionPanel(gate=dd). 경계 #2: 에이전트는 제안만
// 하고, 제안의 승인(판정 대상 편입)과 dd 진행 기록은 사람이 한다. 출처 없는
// 제안은 "출처 없음 (C)"로 눈에 보이게 표시된다 — 결코 출처가 있는 것처럼
// 보이지 않는다 (ADR-0099 §6 정직성 제약).

interface ItemState {
  status: string;
  note: string | null;
  evidence_ref: string | null;
  waiver_id: string | null;
  assessed_by?: string | null;
  assessed_at?: string | null;
}
interface StdItem {
  id: string;
  text: string;
  mandatory: boolean;
  waiver_eligible: boolean;
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

  useEffect(() => { load(null); }, [load]);

  const targets = data?.targets ?? [];
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

  async function tailor() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api.post<{ runId: string; proposedCount: number }>(
        `/api/projects/${encodeURIComponent(projectId)}/dd-checklist/tailor`,
        scopeParam ? { target_id: scopeParam } : {},
      );
      setNotice(
        `산업 맞춤 제안 생성 완료 (run ${r.data.runId}, 제안 ${r.data.proposedCount}건) — 제안 상태로만 기록되었습니다. 승인 전까지 완료 기준에 반영되지 않습니다.`,
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
            setError(e instanceof Error ? e.message : "승인/기각 실패");
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

  async function judge(checklistId: string, itemId: string, status: "pass" | "fail" | "na") {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.put(`/api/projects/${encodeURIComponent(projectId)}/dd-checklist/state`, {
        checklist_id: checklistId,
        item_id: itemId,
        status,
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

  return (
<>
      <StageTabs projectId={projectId} />
      <GateDecisionJump gate="dd" />
      <ReviewBuckets entityType="project" entityId={projectId} gates={["dd"]} artifacts={stageArtifactTabs("S9")} />
      <StageFrame stageId="S9" heading="S9 실사·검증 — DD 체크리스트 판정">
        {data && (
          <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="dd-subject-header">
            {targets.length === 0 ? (
              <p className="text-[length:var(--fs-body)]">
                <strong>실사 대상:</strong> 지정된 대상 회사가 없습니다 — Green Field이거나 Short List 대상이 없는 프로젝트라 프로젝트 기준으로 실사합니다.
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
              {" — "}
              <span className={`status-chip ${data.completion.pending === 0 && data.completion.unassessed === 0 && data.completion.mandatoryUnmet === 0 && data.completion.total > 0 ? "status-green" : "status-amber"}`}>
                {data.completion.total === 0 && data.completion.unassessed === 0
                  ? "판정 기록 없음"
                  : data.completion.pending === 0 && data.completion.unassessed === 0 && data.completion.mandatoryUnmet === 0
                    ? "✓ 판정 완료 · 필수 미충족 0건"
                    : `○ 대기 ${data.completion.pending}건 · 미판정 ${data.completion.unassessed}건 · ✕ 필수 미충족 ${data.completion.mandatoryUnmet}건`}
              </span>
            </>
          )}
          <span className="ml-2 status-chip status-not-started">에이전트 제안 ≠ 승인 — 승인은 사람의 행위입니다</span>
        </p>

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
            <h3 className="sizing-step-title text-[0.9rem]">비교 근거</h3>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              열린 대상별 DD 현황입니다. 합격·불합격 표시 없이 아직 확인하지 못한 항목 수를 그대로 보여주며, 선정 대상 외 행은 게이트 판정에 반영되지 않습니다.
            </p>
            <div className="table-scroll">
              <table className="data-table" aria-label="대상별 DD 비교 근거">
                <caption className="sr-only">열린 대상별 DD 비교 근거 — 전체 항목, 미판정, 판정 대기, 필수 미충족, 가치 영향 조사내역</caption>
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
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void tailor()}>
              {busy ? "생성 중..." : "산업 맞춤 제안 생성 (commercial-dd-agent · technical-dd-agent · legal-counsel)"}
            </button>
          </div>
        )}

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}

        {domain && !viewNotOpened && (
          <>
            <TabNav
              className="mb-0"
              label="DD 체크리스트 도메인"
              active={String(tab)}
              onSelect={(key) => setTab(Number(key))}
              tabs={(data?.domains ?? []).map((d, i) => ({ key: String(i), label: DOMAIN_LABEL[d.domain] ?? d.title }))}
            />

            <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label="항목 필터">
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">보기:</span>
              {([["all", "전체"], ["pending", "판정 대기만"], ["fail", "미충족만"]] as const).map(([k, label]) => (
                <button key={k} type="button" className="control-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
              ))}
              {!canAct && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">판정 기록은 analyst 역할 이상만 할 수 있어 기록 버튼이 보이지 않습니다.</span>}
              {busy && <span role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">기록 중입니다 - 완료될 때까지 판정 버튼이 잠깁니다.</span>}
            </div>
            <div className="table-scroll">
            <table className="data-table dd-table" aria-label={`${domain.title} 체크리스트`}>
              <caption className="sr-only">{domain.title} 체크리스트 판정</caption>
              <thead>
                <tr>
                  <th scope="col" className="dd-col-item">항목</th>
                  <th scope="col" className="dd-col-req">필수</th>
                  <th scope="col" className="dd-col-judge">판정</th>
                  {canAct && <th scope="col" className="dd-col-act">판정 기록</th>}
                </tr>
              </thead>
              <tbody>
                {domain.items.map((item) => {
                  const display = ddItemDisplay(item.state);
                  if (!matchesFilter(filter, display)) return null;
                  const meta = stateMeta(display.status);
                  const ko = koChecklistText(domain.checklistId, item.id, item.text);
                  return (
                    <tr key={item.id}>
                      <td data-label="항목">
                        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums mr-1">{item.id}</span>
                        <span title={ko.translated ? item.text : undefined}>{ko.text}</span>
                        {item.state?.waiver_id && <span className="status-chip status-amber ml-1" title={`waiver ${item.state.waiver_id}`}>⚖ waiver</span>}
                      </td>
                      <td data-label="필수">{item.mandatory ? "필수" : "선택"}</td>
                      <td data-label="판정">
                        <span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span>
                        <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{display.judged ? (display.byline ? `판정: ${display.byline}` : "판정됨") : "아직 판정하지 않음"}</span>
                      </td>
                      {canAct && (
                        <td data-label="판정 기록">
                          <span className="actions-row dd-actions">
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title="충족 판정" onClick={() => void judge(domain.checklistId, item.id, "pass")}>✓ 충족</button>
                            <button type="button" className="btn-danger btn-sm" disabled={busy} title="미충족 판정 (필수 항목은 waiver 없이 S9 완료 불가)" onClick={() => void judge(domain.checklistId, item.id, "fail")}>✕ 미충족</button>
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title="해당 없음 판정" onClick={() => void judge(domain.checklistId, item.id, "na")}>— 해당없음</button>
                            {item.waiver_eligible ? (
                              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => openWaiverDialog(domain.checklistId, item.id, `${item.id} ${ko.text}`)}>
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
                      {canAct && (
                        <td data-label="판정 기록">
                          <span className="actions-row dd-actions">
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void judge(`custom:${c.domain}`, c.id, "pass")}>✓ 충족</button>
                            <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => void judge(`custom:${c.domain}`, c.id, "fail")}>✕ 미충족</button>
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void judge(`custom:${c.domain}`, c.id, "na")}>— 해당없음</button>
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            <section className="market-section sizing-step mt-3" aria-label="산업 맞춤 제안">
              <h3 className="sizing-step-title text-[0.9rem]">산업 맞춤 제안 (proposed)</h3>
              {domain.custom.filter((c) => c.status === "proposed").length === 0 && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">대기 중인 제안이 없습니다 — 에이전트 제안은 실사 체크리스트 수행 중 도착합니다.</p>
              )}
              <ul className="sizing-note-list">
                {domain.custom.filter((c) => c.status === "proposed").map((c) => (
                  <li key={c.id}>
                    {c.item_label}
                    <span className="ml-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={`제안 에이전트 ${c.proposed_by_agent ?? ""}`}>
                      ({DOMAIN_LABEL[c.domain] ?? c.domain} · {c.proposed_by_agent ?? "unknown agent"})
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
                    {canAct && (
                      <span className="actions-row ml-2">
                        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => review(c, "approved")}>승인</button>
                        <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => review(c, "rejected")}>기각</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="market-section sizing-step mt-3" aria-label="조사내역 (dd_finding)">
              <h3 className="sizing-step-title text-[0.9rem]">조사내역 (dd_finding)</h3>
              {(data?.findings.length ?? 0) === 0 && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">등록된 조사내역이 없습니다 — 실사 수행 중 발견한 사실을 상단 폼에서 기록하세요.</p>
              )}
              <ul className="sizing-note-list">
                {(data?.findings ?? []).map((f) => (
                  <li key={f.id}>
                    <strong>{f.category}</strong>: {f.description}
                    {f.value_impact != null && <span className="ml-1 tabular-nums">(가치 영향 {f.value_impact})</span>}
                    {f.evidence_ref && <span className="ml-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title="증적 참조">증적: {f.evidence_ref}</span>}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        <div className="mt-4">
          <WaiverPanel projectId={projectId} targetId={scopeParam} />
        </div>
        <div className="mt-4">
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
