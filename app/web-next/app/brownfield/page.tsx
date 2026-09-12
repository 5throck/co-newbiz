"use client";

import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { GateDecisionPanel } from "../../components/GateDecisionPanel.tsx";
import { CommitteePanel } from "../../components/CommitteePanel.tsx";
import { PromotionPanel } from "../../components/PromotionPanel.tsx";

// S6~S7 브라운필드 대상 경로 (/brownfield) — flow.spec v2.0.0.
//   S6 대상 후보 발굴: Target Universe 정의 → Target Company Long List
//   S7 대상 스크리닝: Long List → chk-target-screening 판정 → Short List 승격/제외
// S1 시장분석 패턴: 기회 칩 → 후보 테이블 → 행 펼침 스크리닝 패널.

interface OppRow {
  id: string; name: string; market_scope: string | null; synergy_score: number | null;
  track: string | null; sub_track: string | null; target_count: number; shortlist_count: number;
}
interface ChecklistItem { id: string; text: string; mandatory: boolean; waiver_eligible: boolean }
interface TargetRow {
  id: string; opportunity_id: string; company_name: string; dart_corp_code: string | null;
  universe_note: string | null; status: "pending" | "shortlisted" | "excluded";
  rank: number | null; exclusion_reason: string | null; screening_json: string | null;
  screening_summary?: { assessed: number; total: number; knockOutsPassed: boolean; anyKnockOutFail: boolean; mandatoryOpen: string[] };
}
interface OppDetail {
  opportunity: { id: string; name: string };
  universe?: { definition: string; criteria?: string[]; scope?: string | null; min_long_list?: number } | null;
  checklist: ChecklistItem[];
  targets: TargetRow[];
}

const STATUS_LABEL: Record<TargetRow["status"], string> = { pending: "대기", shortlisted: "Short List", excluded: "제외" };
const VERDICTS = ["pass", "fail", "na", "waived"] as const;

export function BrownfieldView() {
  const searchParams = useSearchParams();
  const [opps, setOpps] = useState<OppRow[] | null>(null);
  const [selected, setSelected] = useState<OppDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTarget, setOpenTarget] = useState<string | null>(null);
  const [screeningDraft, setScreeningDraft] = useState<Record<string, string>>({});
  const [excludeReason, setExcludeReason] = useState<Record<string, string>>({});
  const [newTarget, setNewTarget] = useState({ company_name: "", dart_corp_code: "", universe_note: "" });
  // S6 Target Universe 정의 — 완료기준(definition + 최소 Long List 커버리지)
  const [universeDraft, setUniverseDraft] = useState({ definition: "", criteria: "", min_long_list: "3" });
  const [savingUniverse, setSavingUniverse] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedId = searchParams.get("opportunity");

  const loadOpps = useCallback(() => {
    api.get<{ opportunities: OppRow[] }>("/api/brownfield").then((r) => setOpps(r.data.opportunities)).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  const loadDetail = useCallback((oppId: string) => {
    api.get<OppDetail>(`/api/brownfield/${encodeURIComponent(oppId)}/targets`)
      .then((r) => { setSelected(r.data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "후보 목록 불러오기 실패"));
  }, []);

  useEffect(() => { loadOpps(); }, [loadOpps]);

  async function saveUniverse() {
    if (!selected || savingUniverse || !universeDraft.definition.trim()) return;
    setSavingUniverse(true); setError(null);
    try {
      await api.put(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets`, {
        definition: universeDraft.definition.trim(),
        criteria: universeDraft.criteria.split(/[,·\n]/).map((s) => s.trim()).filter(Boolean),
        min_long_list: Number(universeDraft.min_long_list) || 3,
      });
      loadDetail(selected.opportunity.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Universe 정의 저장 실패");
    } finally {
      setSavingUniverse(false);
    }
  }

  // Universe 정의 폼 — 상세 카드 안에서 정의/수정 양쪽으로 쓰인다.
  function UniverseForm() {
    return (
      <form
        className="sizing-new-form mb-0"
        onSubmit={(e) => { e.preventDefault(); void saveUniverse(); }}
        aria-label="Target Universe 정의"
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[0.78rem] flex-1 min-w-[16rem]">
            <span className="block mb-1">유니버스 정의 * (후보 풀의 범위)</span>
            <input value={universeDraft.definition} onChange={(e) => setUniverseDraft({ ...universeDraft, definition: e.target.value })} placeholder="예: 국내 상장 로봇 부품·시스템 업체 전체" required className="sizing-new-input w-full" />
          </label>
          <label className="text-[0.78rem] flex-1 min-w-[12rem]">
            <span className="block mb-1">선정 기준 (쉼표 구분)</span>
            <input value={universeDraft.criteria} onChange={(e) => setUniverseDraft({ ...universeDraft, criteria: e.target.value })} placeholder="매출 규모, 기술 보유, 참여 의지" className="sizing-new-input w-full" />
          </label>
          <label className="text-[0.78rem] w-[7rem]">
            <span className="block mb-1">최소 후보 수</span>
            <input type="number" min={1} value={universeDraft.min_long_list} onChange={(e) => setUniverseDraft({ ...universeDraft, min_long_list: e.target.value })} className="sizing-new-input sizing-new-input-sm" />
          </label>
          <button type="submit" className="btn-ghost btn-sm" disabled={savingUniverse || !universeDraft.definition.trim()}>
            {savingUniverse ? "저장 중..." : "Universe 저장"}
          </button>
        </div>
      </form>
    );
  }

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const openOpportunity = useCallback((o: OppRow) => {
    window.history.replaceState(null, "", `/brownfield?opportunity=${encodeURIComponent(o.id)}`);
    loadDetail(o.id);
  }, [loadDetail]);

  async function addTarget(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !newTarget.company_name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/brownfield/${selected.opportunity.id}/targets`, {
        company_name: newTarget.company_name.trim(),
        dart_corp_code: newTarget.dart_corp_code.trim() || undefined,
        universe_note: newTarget.universe_note.trim() || undefined,
      });
      setNewTarget({ company_name: "", dart_corp_code: "", universe_note: "" });
      loadDetail(selected.opportunity.id);
      loadOpps();
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보 등록 실패");
    } finally {
      setBusy(false);
    }
  }

  async function saveScreening(targetId: string) {
    if (!selected) return;
    const states: Record<string, string> = {};
    for (const item of selected.checklist) {
      const v = screeningDraft[`${targetId}:${item.id}`];
      if (v) states[item.id] = v;
    }
    if (Object.keys(states).length === 0) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ target: TargetRow }>(`/api/brownfield/${selected.opportunity.id}/targets/${targetId}`, { states });
      const updated = selected.targets.map((t) => (t.id === targetId ? { ...t, ...res.data.target } : t));
      setSelected({ ...selected, targets: updated });
      setScreeningDraft((prev) => { const n = { ...prev }; Object.keys(states).forEach((k) => delete n[`${targetId}:${k}`]); return n; });
    } catch (err) {
      setError(err instanceof Error ? err.message : "판정 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function shortlist(targetId: string) {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/brownfield/${selected.opportunity.id}/targets/${targetId}/shortlist`, {});
      loadDetail(selected.opportunity.id);
      loadOpps();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Short List 승격 실패");
    } finally {
      setBusy(false);
    }
  }

  async function exclude(targetId: string) {
    if (!selected) return;
    const reason = excludeReason[targetId]?.trim();
    if (!reason) { setError("제외 사유를 입력하세요."); return; }
    setBusy(true); setError(null);
    try {
      await api.post(`/api/brownfield/${selected.opportunity.id}/targets/${targetId}/exclude`, { reason });
      setExcludeReason((prev) => { const n = { ...prev }; delete n[targetId]; return n; });
      loadDetail(selected.opportunity.id);
      loadOpps();
    } catch (err) {
      setError(err instanceof Error ? err.message : "제외 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <StageFrame stageId={["S6", "S7"]} track="brownfield">
        Brownfield 경로 — 진출방식이 Brownfield로 결정된 기회의
        대상 후보를 발굴하고(S6 Long List), <code>chk-target-screening</code> 체크리스트로 스크리닝해
        Short List로 좁힙니다(S7). CDD/TDD는 Short List 확정 후 S9에서 수행합니다.
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── Brownfield 기회 (칩) ── */}
      <section aria-label="브라운필드 기회" className="market-section">
        <div className="section-toolbar"><span className="section-title"><h2>🎯 Brownfield로 결정된 기회</h2></span></div>
        {opps === null ? (
          <p>불러오는 중...</p>
        ) : opps.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
            Brownfield로 결정된 기회가 없습니다 — <a href="/route-decision" className="text-[color:var(--accent)] underline">진출방식 결정(S4)</a>에서 트랙을 정하세요.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {opps.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={selected?.opportunity.id === o.id}
                className={`sizing-industry-chip ${selected?.opportunity.id === o.id ? "sizing-industry-chip-active" : ""}`}
                onClick={() => openOpportunity(o)}
              >
                <span className="font-semibold">{o.name}</span>
                <span className="sizing-chip-meta">Long List {o.target_count} · Short List {o.shortlist_count}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── S6/S7: 후보 등록 + Long List + 스크리닝 ── */}
      {selected && (
        <section aria-label="대상 후보 스크리닝" className="market-section">
          <SectionToolbar
            title={`${selected.opportunity.name} — Long List → Short List`}
            icon="🏢"
            summary={
              <span className="section-meta">
                {selected.targets.filter((t) => t.status === "shortlisted").length} Short List / {selected.targets.length} Long List
              </span>
            }
          />

          {/* S6 — Target Universe 정의 (완료기준: 정의 + 최소 Long List 커버리지, ADR-0094) */}
          <div className="sizing-grade-card mb-3">
            <h4 className="text-[0.85rem] mb-2">🎯 Target Universe 정의</h4>
            {selected.universe ? (
              <>
                <p className="mb-1 text-[0.85rem]">{selected.universe.definition}</p>
                {(selected.universe.criteria?.length ?? 0) > 0 && (
                  <p className="mb-1 text-[0.78rem] text-[color:var(--muted-fg)]">선정 기준: {selected.universe.criteria!.join(" · ")}</p>
                )}
                {selected.universe.scope && <p className="mb-1 text-[0.78rem] text-[color:var(--muted-fg)]">커버리지 범위: {selected.universe.scope}</p>}
                <p className="mb-0 text-[0.78rem]">
                  커버리지:{" "}
                  <span className={`status-chip ${selected.targets.filter((t) => t.status !== "excluded").length >= (selected.universe.min_long_list ?? 3) ? "status-green" : "status-amber"}`}>
                    Long List {selected.targets.filter((t) => t.status !== "excluded").length} / 최소 {selected.universe.min_long_list ?? 3}
                  </span>
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[0.78rem] text-[color:var(--accent)]">정의 수정</summary>
                  <UniverseForm />
                </details>
              </>
            ) : (
              <>
                <p className="mb-2 text-[0.8rem] text-[color:var(--muted-fg)]">
                  아직 정의되지 않았습니다 — S6 완료기준입니다. 후보 등록 전에 선정 기준과 최소 커버리지를 확정하세요.
                </p>
                <UniverseForm />
              </>
            )}
          </div>

          {/* S6 — 후보 등록 (Target Universe 근거 포함) */}
          <form onSubmit={addTarget} className="sizing-new-form mb-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[0.78rem]">
                <span className="block mb-1">후보 회사명 * (Long List)</span>
                <input value={newTarget.company_name} onChange={(e) => setNewTarget({ ...newTarget, company_name: e.target.value })} placeholder="예: 레인보우로보틱스" required className="sizing-new-input" />
              </label>
              <label className="text-[0.78rem]">
                <span className="block mb-1">DART 고유번호 (선택, 8자리)</span>
                <input value={newTarget.dart_corp_code} onChange={(e) => setNewTarget({ ...newTarget, dart_corp_code: e.target.value })} placeholder="8자리 고유번호" className="sizing-new-input sizing-new-input-sm" />
              </label>
              <label className="text-[0.78rem]">
                <span className="block mb-1">Universe 근거 (선택)</span>
                <input value={newTarget.universe_note} onChange={(e) => setNewTarget({ ...newTarget, universe_note: e.target.value })} placeholder="선정 기준·가치사슬 위치 등" className="sizing-new-input sizing-new-input-sm" />
              </label>
              <button type="submit" className="btn-ghost btn-sm" disabled={busy || !newTarget.company_name.trim()}>후보 등록</button>
            </div>
            <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
              S6 대상 후보 발굴 — Target Universe 정의(선정 기준·커버리지)를 기반으로 후보를 등록합니다.
              각 후보는 S7에서 <code>chk-target-screening</code>(t-01~t-09)로 스크리닝됩니다.
            </p>
          </form>

          {/* Long List 테이블 */}
          {selected.targets.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">Long List 후보가 없습니다 — 위에서 후보를 등록하세요.</p>
          ) : (
            <table className="data-table" aria-label="Long List">
              <caption className="sr-only">Long List 후보</caption>
              <thead>
                <tr>
                  <th scope="col">후보</th><th scope="col">DART</th><th scope="col">상태</th>
                  <th scope="col">스크리닝</th><th scope="col">제외 사유</th>
                </tr>
              </thead>
              <tbody>
                {selected.targets.map((t) => {
                  const sm = t.screening_summary;
                  const isOpen = openTarget === t.id;
                  return (
                    <Fragment key={t.id}>
                      <tr key={t.id} className={isOpen ? "row-selected" : undefined}>
                        <td className="cell-primary">
                          <button
                            type="button"
                            className="font-semibold text-left underline-offset-2 hover:underline"
                            title="행을 펼쳐 스크리닝 판정"
                            onClick={() => setOpenTarget(isOpen ? null : t.id)}
                          >
                            {t.company_name}
                          </button>
                          {t.universe_note && <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">{t.universe_note}</span>}
                        </td>
                        <td><code className="dd-item-id">{t.dart_corp_code ?? "—"}</code></td>
                        <td>
                          <span className={`status-chip ${t.status === "shortlisted" ? "status-green" : t.status === "excluded" ? "status-red" : "status-not-started"}`}>
                            {STATUS_LABEL[t.status]}{t.status === "shortlisted" && t.rank ? ` #${t.rank}` : ""}
                          </span>
                        </td>
                        <td className="tabular-nums">
                          {sm ? (
                            sm.knockOutsPassed && t.status === "pending" ? (
                              <span className="status-chip status-amber" title="knock-out 통과 — 승격 가능">판정 {sm.assessed}/{sm.total}</span>
                            ) : sm.anyKnockOutFail ? (
                              <span className="status-chip status-red" title="knock-out fail — 제외 권장">knock-out 실패</span>
                            ) : (
                              <span className={`status-chip ${sm.mandatoryOpen.length ? "status-amber" : "status-green"}`}>판정 {sm.assessed}/{sm.total}</span>
                            )
                          ) : "—"}
                        </td>
                        <td className="text-[0.75rem] text-[color:var(--muted-fg)]">{t.exclusion_reason ?? "—"}</td>
                      </tr>
                      {isOpen && (
                        <tr key={`${t.id}-detail`}>
                          <td colSpan={5}>
                            <div className="text-[0.78rem] py-1">
                              <h4 className="text-[0.85rem] mb-2">⚖️ S7 스크리닝 — chk-target-screening (t-01~t-09)</h4>
                              <ul className="sizing-note-list">
                                {selected.checklist.map((item) => {
                                  const key = `${t.id}:${item.id}`;
                                  const current = screeningDraft[key] ?? (t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>)[item.id] : undefined) ?? "pending";
                                  return (
                                    <li key={item.id} className="flex flex-wrap items-start gap-2">
                                      <code className="dd-item-id mt-1">{item.id}</code>
                                      <span className="flex-1 min-w-[16rem]">{item.text}</span>
                                      {item.mandatory && <span className="status-chip status-amber">필수</span>}
                                      <select
                                        aria-label={`${item.id} 판정`}
                                        value={screeningDraft[key] ?? current}
                                        onChange={(e) => setScreeningDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                                        className="sizing-new-input sizing-new-input-sm"
                                      >
                                        <option value="pending">미판정</option>
                                        {VERDICTS.map((v) => (
                                          <option key={v} value={v}>
                                            {v === "pass" ? "충족" : v === "fail" ? "미충족" : v === "na" ? "해당없음" : "예외"}
                                          </option>
                                        ))}
                                      </select>
                                    </li>
                                  );
                                })}
                              </ul>
                              <div className="flex flex-wrap items-center gap-2 mt-3">
                                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => saveScreening(t.id)}>판정 저장</button>
                                {t.status !== "shortlisted" && (
                                  <button
                                    type="button"
                                    className="btn-ghost btn-sm"
                                    disabled={busy || !sm?.knockOutsPassed}
                                    title={sm && !sm.knockOutsPassed ? "knock-out 통과 + 필수 항목 판정 후 승격 가능합니다" : "Short List 승격"}
                                    onClick={() => shortlist(t.id)}
                                  >
                                    Short List 승격
                                  </button>
                                )}
                                {t.status !== "excluded" && (
                                  <span className="flex items-center gap-1">
                                    <input
                                      aria-label="제외 사유"
                                      placeholder="제외 사유"
                                      value={excludeReason[t.id] ?? ""}
                                      onChange={(e) => setExcludeReason((prev) => ({ ...prev, [t.id]: e.target.value }))}
                                      className="sizing-new-input sizing-new-input-sm"
                                      style={{ flex: "1 1 12rem" }}
                                    />
                                    <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => exclude(t.id)}>제외</button>
                                  </span>
                                )}
                              </div>
                              {sm && sm.mandatoryOpen.length > 0 && (
                                <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">필수 미판정: {sm.mandatoryOpen.join(", ")}</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
      {selected && (
        <>
          <GateDecisionPanel
            opportunityId={selected.opportunity.id}
            gates={["target_screening"]}
            killHint={
              selected.targets.length > 0 && !selected.targets.some((t) => t.status !== "excluded" && (t.screening_summary?.knockOutsPassed ?? false))
                ? "knock-out 통과 후보 0건 — Target Screening 게이트 KILL 기준 검토가 필요합니다 (flow.spec S7 kill criteria)."
                : null
            }
          />
          {/* ADR-0097: target-longlist-shortlist-committee 심의 — 에이전트는 제안, 확정은 인간 */}
          {selected.targets.length > 0 && (
            <CommitteePanel
              opportunityId={selected.opportunity.id}
              committeeKey="target-longlist-shortlist-committee"
              committeeLabel="S6/S7 대상 롱리스트→숏리스트 위원회"
              gates={["screening"]}
            />
          )}
          {/* ADR-0095 — S7→S8 승격 표면: 완료 요건 충족 시 사람이 승격을 기록한다 */}
          <PromotionPanel
            opportunityId={selected.opportunity.id}
            heading={`${selected.opportunity.name} — 프로젝트로 승격 (S7 → S8)`}
          />
        </>
      )}
    </main>
  );
}

export default function BrownfieldPage() {
  return (
    <Suspense fallback={null}>
      <BrownfieldView />
    </Suspense>
  );
}
