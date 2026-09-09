"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { api } from "../../../../lib/api.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { GateDecisionPanel } from "../../../../components/GateDecisionPanel.tsx";
import { WaiverPanel } from "../../../../components/WaiverPanel.tsx";
import { useConfirm } from "../../../../components/crud.tsx";

// S9 실사·검증 — 표준 DD 체크리스트 판정 + 산업 맞춤 제안 승인 화면 (ADR-0099 §4).
// 표준 체크리스트 3개(commercial/technical/legal) 탭 + 산업 맞춤 제안 패널
// + dd_finding 목록 + GateDecisionPanel(gate=dd). 경계 #2: 에이전트는 제안만
// 하고, 제안의 승인(판정 대상 편입)과 dd 게이트 기록은 사람이 한다. 출처 없는
// 제안은 "출처 없음 (C)"로 눈에 보이게 표시된다 — 결코 출처가 있는 것처럼
// 보이지 않는다 (ADR-0099 §6 정직성 제약).

interface ItemState {
  status: string;
  note: string | null;
  evidence_ref: string | null;
  waiver_id: string | null;
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
interface WorkspaceView {
  domains: DomainView[];
  findings: FindingRow[];
  completion: { total: number; pending: number; mandatoryUnmet: number };
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

const DOMAIN_LABEL: Record<string, string> = { commercial: "Commercial", technical: "Technical", legal: "Legal" };

export default function DdPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { me } = useAuth();
  const canAct = me?.role === "admin" || me?.role === "analyst";
  const { confirm, confirmDialog } = useConfirm();
  const [data, setData] = useState<WorkspaceView | null>(null);
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // ⚖ waiver 연결 대상 항목 — WaiverPanel에서 만든 활성 waiver를 판정에 연결한다.
  const [waiverPick, setWaiverPick] = useState<{ checklistId: string; itemId: string } | null>(null);
  const [activeWaivers, setActiveWaivers] = useState<Array<{ id: string; clause_ref: string; governance_doc_id: string; expires_at: string }>>([]);

  const load = useCallback(() => {
    api.get<WorkspaceView>(`/api/projects/${encodeURIComponent(projectId)}/dd`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "실사 데이터를 불러오지 못했습니다."));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function tailor() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api.post<{ runId: string; proposedCount: number }>(
        `/api/projects/${encodeURIComponent(projectId)}/dd-checklist/tailor`,
        {},
      );
      setNotice(
        `산업 맞춤 제안 생성 완료 (run ${r.data.runId}, 제안 ${r.data.proposedCount}건) — 제안 상태로만 기록되었습니다. 승인 전까지 완료 기준에 반영되지 않습니다.`,
      );
      load();
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
            load();
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
      });
      setNotice("판정이 기록되었습니다.");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "판정 기록 실패");
    } finally {
      setBusy(false);
    }
  }

  /** ⚖ waiver 연결 — 활성 waiver 목록을 열어 항목에 waived 판정을 기록한다. */
  function openWaiverPick(checklistId: string, itemId: string) {
    setError(null);
    api.get<{ waivers: Array<{ id: string; clause_ref: string; governance_doc_id: string; expires_at: string; effective_status: string }> }>(
      `/api/projects/${encodeURIComponent(projectId)}/waivers`,
    )
      .then((r) => {
        const active = r.data.waivers.filter((w) => w.effective_status === "active");
        setActiveWaivers(active);
        if (active.length === 0) {
          setError("연결 가능한 활성 waiver가 없습니다 — 먼저 WaiverPanel에서 waiver를 요청·승인하세요.");
          return;
        }
        setWaiverPick({ checklistId, itemId });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "waiver 목록 조회 실패"));
  }

  async function judgeWaived(waiverId: string) {
    if (!waiverPick || busy) return;
    setBusy(true); setError(null);
    try {
      await api.put(`/api/projects/${encodeURIComponent(projectId)}/dd-checklist/state`, {
        checklist_id: waiverPick.checklistId,
        item_id: waiverPick.itemId,
        status: "waived",
        waiver_id: waiverId,
      });
      setNotice("waiver가 연결된 판정(waived)이 기록되었습니다.");
      setWaiverPick(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "waived 판정 기록 실패");
    } finally {
      setBusy(false);
    }
  }

  const domain = data?.domains[tab];

  return (
    <main>
      <ProjectSubNav projectId={projectId} />
      <StageFrame stageId="S9" heading="S9 실사·검증 — DD 체크리스트 판정">
        <p className="text-[0.82rem] text-[color:var(--muted-fg)] mb-2">
          적용 체크리스트의 모든 항목이 판정되고 필수 미충족이 0건이어야 S9이 완료됩니다 (flow.spec v2.0.0).
          {data && (
            <>
              {" — "}
              <span className={`status-chip ${data.completion.pending === 0 && data.completion.mandatoryUnmet === 0 && data.completion.total > 0 ? "status-green" : "status-amber"}`}>
                {data.completion.total === 0
                  ? "판정 기록 없음"
                  : data.completion.pending === 0 && data.completion.mandatoryUnmet === 0
                    ? "✓ 판정 완료 · 필수 미충족 0건"
                    : `○ 대기 ${data.completion.pending}건 · ✕ 필수 미충족 ${data.completion.mandatoryUnmet}건`}
              </span>
            </>
          )}
          <span className="ml-2 status-chip status-not-started">에이전트 제안 ≠ 승인 — 승인은 사람의 행위입니다</span>
        </p>

        {canAct && (
          <div className="mb-3">
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void tailor()}>
              {busy ? "생성 중..." : "산업 맞춤 제안 생성 (commercial-dd-agent · technical-dd-agent · legal-counsel)"}
            </button>
          </div>
        )}

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mb-2">✕ {error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[0.82rem] mb-2">✓ {notice}</p>}

        {domain && (
          <>
            <div className="tab-nav mb-0" role="tablist" aria-label="DD 체크리스트 도메인">
              {(data?.domains ?? []).map((d, i) => (
                <button
                  key={d.domain}
                  type="button"
                  role="tab"
                  aria-current={i === tab}
                  aria-selected={i === tab}
                  onClick={() => setTab(i)}
                >
                  {DOMAIN_LABEL[d.domain] ?? d.title}
                </button>
              ))}
            </div>

            <div className="table-scroll">
            <table className="data-table" aria-label={`${domain.title} 체크리스트`}>
              <caption className="sr-only">{domain.title} 체크리스트 판정</caption>
              <thead>
                <tr>
                  <th scope="col">항목</th>
                  <th scope="col">필수</th>
                  <th scope="col">판정</th>
                  {canAct && <th scope="col">판정 기록</th>}
                </tr>
              </thead>
              <tbody>
                {domain.items.map((item) => {
                  const meta = stateMeta(item.state?.status);
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="text-[0.72rem] text-[color:var(--muted-fg)] tabular-nums mr-1">{item.id}</span>
                        {item.text}
                        {item.state?.waiver_id && <span className="status-chip status-amber ml-1" title={`waiver ${item.state.waiver_id}`}>⚖ waiver</span>}
                      </td>
                      <td>{item.mandatory ? "필수" : "선택"}</td>
                      <td>
                        <span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span>
                      </td>
                      {canAct && (
                        <td>
                          <span className="actions-row">
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title="충족 판정" onClick={() => void judge(domain.checklistId, item.id, "pass")}>✓ 충족</button>
                            <button type="button" className="btn-danger btn-sm" disabled={busy} title="미충족 판정 (필수 항목은 waiver 없이 S9 완료 불가)" onClick={() => void judge(domain.checklistId, item.id, "fail")}>✕ 미충족</button>
                            <button type="button" className="btn-ghost btn-sm" disabled={busy} title="해당 없음 판정" onClick={() => void judge(domain.checklistId, item.id, "na")}>— 해당없음</button>
                            {item.waiver_eligible && (
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                disabled={busy}
                                title="활성 waiver를 연결해 면제 판정 (waived —WaiverPanel에서 사전 승인 필요)"
                                onClick={() => openWaiverPick(domain.checklistId, item.id)}
                              >
                                ⚖ waiver
                              </button>
                            )}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {/* 승인된 맞춤 항목은 일반 항목이다 — 같은 표에서 같은 방식으로 판정된다 (ADR-0099 §4). */}
                {domain.custom.filter((c) => c.status === "approved").map((c) => {
                  const meta = stateMeta(c.state?.status);
                  return (
                    <tr key={c.id}>
                      <td>
                        <span className="text-[0.72rem] text-[color:var(--muted-fg)] tabular-nums mr-1">{DOMAIN_LABEL[c.domain] ?? c.domain}-custom</span>
                        {c.item_label}
                        <span className="status-chip status-not-started ml-1" title="산업 맞춤 제안에서 승인된 항목">맞춤</span>
                        {c.state?.waiver_id && <span className="status-chip status-amber ml-1" title={`waiver ${c.state.waiver_id}`}>⚖ waiver</span>}
                      </td>
                      <td>필수 (승인 편입)</td>
                      <td><span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span></td>
                      {canAct && (
                        <td>
                          <span className="actions-row">
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
                <p className="text-[0.82rem] text-[color:var(--muted-fg)]">대기 중인 제안이 없습니다.</p>
              )}
              <ul className="sizing-note-list">
                {domain.custom.filter((c) => c.status === "proposed").map((c) => (
                  <li key={c.id}>
                    {c.item_label}
                    <span className="ml-1 text-[0.72rem] text-[color:var(--muted-fg)]" title={`제안 에이전트 ${c.proposed_by_agent ?? ""}`}>
                      ({DOMAIN_LABEL[c.domain] ?? c.domain} · {c.proposed_by_agent ?? "unknown agent"})
                    </span>
                    {c.rationale && <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">근거: {c.rationale}</span>}
                    {c.source_url ? (
                      <a className="text-[0.72rem]" href={c.source_url} target="_blank" rel="noreferrer">
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
                <p className="text-[0.82rem] text-[color:var(--muted-fg)]">등록된 조사내역이 없습니다.</p>
              )}
              <ul className="sizing-note-list">
                {(data?.findings ?? []).map((f) => (
                  <li key={f.id}>
                    <strong>{f.category}</strong>: {f.description}
                    {f.value_impact != null && <span className="ml-1 tabular-nums">(가치 영향 {f.value_impact})</span>}
                    {f.evidence_ref && <span className="ml-1 text-[0.72rem] text-[color:var(--muted-fg)]" title="증적 참조">증적: {f.evidence_ref}</span>}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        <div className="mt-4">
          <WaiverPanel projectId={projectId} />
        </div>
        <div className="mt-4">
          <GateDecisionPanel opportunityId={projectId} gates={["dd"]} entityType="project" />
        </div>
        {waiverPick && (
          <div className="modal-backdrop" onClick={() => setWaiverPick(null)}>
            <div className="modal-panel" role="dialog" aria-modal="true" aria-label="waiver 연결" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-[1rem] font-semibold mb-2">활성 waiver 연결</h3>
              <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-3">
                항목 {waiverPick.itemId} 에 연결할 활성 waiver를 선택합니다 — 면제 판정(waived)은 사유와 만료가 기록된 승인 waiver에만 가능합니다 (ADR-0036).
              </p>
              <ul className="space-y-2 mb-3">
                {activeWaivers.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      className="btn-ghost btn-sm w-full text-left"
                      disabled={busy}
                      onClick={() => void judgeWaived(w.id)}
                    >
                      ⚖ {w.governance_doc_id} {w.clause_ref} — 만료 {w.expires_at.slice(0, 10)}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <button type="button" className="btn-ghost btn-sm" onClick={() => setWaiverPick(null)}>취소</button>
              </div>
            </div>
          </div>
        )}
        {confirmDialog}
      </StageFrame>
    </main>
  );
}
