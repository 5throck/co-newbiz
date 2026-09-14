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
//   S7 대상 선정: Long List → chk-target-screening 판정 → Short List 승격/제외
// S1 시장분석 패턴: 기회 칩 → 후보 테이블 → 행 펼침 스크리닝 패널.
// S7 추려내기 가시화(2026-09-14 사용자 리포트): 선정 퍼널(Long List → 판정
// 완료 → 승격 가능 → Short List), 후보별 t-01~t-09 판정 스트립, 결정론 선정
// 점수(flow.spec S7 산출물 Target Ranking/Score), Short List 순위 조정.

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

const STATUS_LABEL: Record<TargetRow["status"], string> = { pending: "심사 중", shortlisted: "Short List", excluded: "제외" };
const VERDICTS = ["pass", "fail", "na", "waived"] as const;
const VERDICT_KO: Record<string, string> = { pass: "충족", fail: "미충족", na: "해당없음", waived: "예외", pending: "미판정" };

// S7 선정 점수 — 판정값에서 결정론 산출한다(flow.spec S7 산출물 "Target
// Ranking/Score"의 증거). 게이트(t-01~02, 예외 불가)는 통과 조건일 뿐 점수에서
// 제외하고, 예외 가능 항목(충족·해당없음 1점 / 예외 0.5점 / 미충족 0점)을
// 백분율로 환산한다. 전 항목 판정 완료 시에만 점수를 확정 표시한다.
function targetScore(states: Record<string, string>, checklist: ChecklistItem[]): { pct: number | null; judged: number; total: number } {
  const scored = checklist.filter((c) => c.waiver_eligible);
  let sum = 0;
  let judged = 0;
  for (const it of scored) {
    const st = states[it.id];
    if (!st || st === "pending") continue;
    judged++;
    sum += st === "pass" || st === "na" ? 1 : st === "waived" ? 0.5 : 0;
  }
  return { pct: scored.length > 0 && judged === scored.length ? Math.round((sum / scored.length) * 100) : null, judged, total: scored.length };
}

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
  // 상태 필터 — Long List(심사 중)/Short List/제외로 좁혀 훑어본다(S1 필터 칩 패턴).
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "shortlisted" | "excluded">("all");

  const selectedId = searchParams.get("opportunity");
  interface Suggestion { id: string; name_ko: string; dart_corp_code: string | null }
  const [proposals, setProposals] = useState<Suggestion[] | null>(null);

  const loadProposals = useCallback(() => {
    if (!selectedId) { setProposals(null); return; }
    api.get<{ suggestions: Suggestion[] }>(`/api/projects/${encodeURIComponent(selectedId)}/target-proposals`)
      .then((r) => setProposals(r.data.suggestions))
      .catch(() => setProposals([]));
  }, [selectedId]);
  useEffect(() => { loadProposals(); }, [loadProposals]);

  async function acceptProposal(companyName: string, dartCorpCode: string | null) {
    try {
      await api.post(`/api/projects/${encodeURIComponent(selectedId ?? "")}/target-proposals`, {
        company_name: companyName, dart_corp_code: dartCorpCode || undefined, discovery_source: "master_proposal",
      });
      setProposals((prev) => (prev ?? []).filter((c) => c.name_ko !== companyName));
      loadDetail(selectedId ?? "");
      loadOpps();
    } catch (err) { setError(err instanceof Error ? err.message : "수용 실패"); }
  }

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

  // Short List 순위 조정 — 이웃 행과 rank를 교환한다(사람이 확정하는 순위).
  async function rerank(targetId: string, direction: "up" | "down") {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/brownfield/${selected.opportunity.id}/targets/${targetId}/rerank`, { direction });
      loadDetail(selected.opportunity.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "순위 변경 실패");
    } finally {
      setBusy(false);
    }
  }

  // ── S7 선정 퍼널 집계 — Long List에서 Short List로 좁히는 과정의 스냅샷 ──
  const targets = selected?.targets ?? [];
  const shortlistedTargets = targets.filter((t) => t.status === "shortlisted");
  const excludedTargets = targets.filter((t) => t.status === "excluded");
  const fullyAssessed = targets.filter((t) => t.screening_summary && t.screening_summary.assessed === t.screening_summary.total);
  const promotionReady = targets.filter((t) => t.status === "pending" && t.screening_summary?.knockOutsPassed);
  // S7 완료기준(모든 후보가 랭킹 점수 또는 제외 사유)의 남은 작업 목록.
  const openTargets = targets.filter((t) => t.status === "pending" && !t.screening_summary?.knockOutsPassed);
  const displayedTargets = statusFilter === "all" ? targets : targets.filter((t) => t.status === statusFilter);
  const statusCounts: Record<typeof statusFilter, number> = {
    all: targets.length,
    pending: targets.length - shortlistedTargets.length - excludedTargets.length,
    shortlisted: shortlistedTargets.length,
    excluded: excludedTargets.length,
  };
  const shortlistOrder = shortlistedTargets.map((t) => t.id);

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
        <div className="section-toolbar"><span className="section-title"><h2>Brownfield로 결정된 기회</h2></span></div>
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

      {/* ── S6 ② 후보 발굴 제안 (deterministic master-data 기반, provenance 기록) ── */}
      {selected && (
        <section aria-label="후보 제안" className="market-section">
          <h2 className="text-[0.9rem] mb-2">후보 발굴 제안 <span className="note">— 시장·기업 마스터 기반 (결정론)</span></h2>
          {proposals === null ? <p className="text-[0.8rem]">불러오는 중...</p> : proposals.length === 0 ? (
            <p className="note" style={{ marginBottom: 0 }}>제안 가능한 신규 후보가 없습니다 — 아래에서 직접 등록하세요.</p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-2">
              {proposals.map((c) => (
                <button key={c.id} type="button" className="control-chip"
                  title={c.dart_corp_code ? `DART ${c.dart_corp_code}` : undefined}
                  onClick={() => acceptProposal(c.name_ko, c.dart_corp_code)}>
                  ＋ {c.name_ko}
                </button>
              ))}
            </div>
          )}
          <p className="note" style={{ marginBottom: 0 }}>수용하면 발굴 출처(discovery_source)가 기록됩니다 — 제안은 결정론 소스이며 웹 검색 제안은 별도 라벨링 예정입니다.</p>
        </section>
      )}

      {/* ── S6/S7: 후보 등록 + Long List + 스크리닝 ── */}
      {selected && (
        <section aria-label="대상 후보 스크리닝" className="market-section">
          <SectionToolbar
            title={`${selected.opportunity.name} — Long List → Short List`}
            icon=""
            filters={
              <span role="group" aria-label="후보 상태 필터" className="flex items-center gap-1 flex-wrap">
                {([["all", "전체"], ["pending", "심사 중"], ["shortlisted", "Short List"], ["excluded", "제외"]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={statusFilter === key}
                    className={`control-chip ${statusFilter === key ? "status-green" : "status-not-started"}`}
                    onClick={() => setStatusFilter(key)}
                  >
                    {label} {statusCounts[key]}
                  </button>
                ))}
              </span>
            }
            summary={
              <span className="section-meta">
                {shortlistedTargets.length} Short List / {targets.length} Long List
              </span>
            }
          />

          {/* S6 — Target Universe 정의 (완료기준: 정의 + 최소 Long List 커버리지, ADR-0094) */}
          <div className="sizing-grade-card mb-3">
            <h4 className="text-[0.85rem] mb-2">Target Universe 정의</h4>
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

          {/* S7 선정 퍼널 — Long List에서 Short List로 좁히는 과정을 한눈에
              보여준다. 완료기준(flow.spec S7): 모든 후보가 랭킹 점수 또는 제외
              사유를 갖는다. */}
          {targets.length > 0 && (
            <div className="mb-3">
              <div role="group" aria-label="S7 선정 퍼널" className="flex flex-wrap items-center gap-1">
                <span className="control-chip status-not-started">Long List {targets.length}</span>
                <span aria-hidden="true" className="text-[color:var(--muted-fg)]">→</span>
                <span className="control-chip status-amber" title="t-01~t-09 9개 항목을 모두 판정한 후보">판정 완료 {fullyAssessed.length}</span>
                <span aria-hidden="true" className="text-[color:var(--muted-fg)]">→</span>
                <span className="control-chip status-amber" title="knock-out 통과 — Short List 승격 가능">승격 가능 {promotionReady.length}</span>
                <span aria-hidden="true" className="text-[color:var(--muted-fg)]">→</span>
                <span className="control-chip status-green">Short List {shortlistedTargets.length}</span>
                <span className="control-chip status-not-started" title="제외 사유가 기록된 후보">제외 {excludedTargets.length}</span>
              </div>
              {openTargets.length > 0 ? (
                <p className="note mt-1 mb-0">S7 완료까지 — 판정 또는 제외가 남은 후보: {openTargets.map((t) => t.company_name).join(", ")}</p>
              ) : (
                <p className="note mt-1 mb-0">
                  모든 후보의 판정이 완료되었습니다 — 아래 위원회 심의(제안)와 target_screening 게이트 결정(사람)으로 Short List를 확정하세요.
                </p>
              )}
            </div>
          )}

          {/* Long List 테이블 */}
          {targets.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">Long List 후보가 없습니다 — 위에서 후보를 등록하세요.</p>
          ) : displayedTargets.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">해당 상태의 후보가 없습니다.</p>
          ) : (
            <table className="data-table" aria-label="Long List">
              <caption className="sr-only">Long List 후보 — S7 스크리닝 현황</caption>
              <thead>
                <tr>
                  <th scope="col">후보</th><th scope="col">DART</th>
                  <th scope="col" title="chk-target-screening t-01~t-09 판정 현황 — 충: 충족, 미: 미충족, 예: 예외, N: 해당없음">S7 판정</th>
                  <th scope="col" title="선정 점수 — 예외 가능 항목(t-03~t-09) 충족·해당없음 1점, 예외 0.5점, 미충족 0점">점수</th>
                  <th scope="col">상태</th>
                  <th scope="col">제외 사유</th>
                </tr>
              </thead>
              <tbody>
                {displayedTargets.map((t) => {
                  const sm = t.screening_summary;
                  const isOpen = openTarget === t.id;
                  const states = t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>) : {};
                  const score = targetScore(states, selected.checklist);
                  const orderIdx = shortlistOrder.indexOf(t.id);
                  const canPromote = t.status === "pending" && Boolean(sm?.knockOutsPassed);
                  return (
                    <Fragment key={t.id}>
                      <tr className={isOpen ? "row-selected" : undefined}>
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
                          <span className="flex items-center gap-0.5" aria-label={`S7 판정 ${sm ? `${sm.assessed}/${sm.total}` : `0/${selected.checklist.length}`}`}>
                            {selected.checklist.map((it) => {
                              const st = states[it.id] ?? "pending";
                              const [glyph, cls] = st === "pass" ? ["충", "status-green"] : st === "fail" ? ["미", "status-red"] : st === "waived" ? ["예", "status-amber"] : st === "na" ? ["N", "status-not-started"] : ["·", "status-not-started"];
                              return (
                                <span key={it.id} className={`status-chip ${cls}`} style={{ minWidth: "1.5rem", padding: "0 0.2rem", textAlign: "center" }} title={`${it.id} — ${VERDICT_KO[st]}`}>
                                  {glyph}
                                </span>
                              );
                            })}
                          </span>
                        </td>
                        <td className="tabular-nums" title="선정 점수 — 예외 가능 항목(t-03~t-09) 충족·해당없음 1점, 예외 0.5점, 미충족 0점. 판정 완료 시 확정 표시.">
                          {score.pct !== null ? `${score.pct}%` : <span className="text-[color:var(--muted-fg)]">{score.judged}/{score.total}</span>}
                        </td>
                        <td>
                          <span className="flex items-center gap-1">
                            <span className={`status-chip ${t.status === "shortlisted" ? "status-green" : t.status === "excluded" ? "status-red" : "status-not-started"}`}>
                              {STATUS_LABEL[t.status]}{t.status === "shortlisted" && t.rank ? ` #${t.rank}` : ""}
                            </span>
                            {canPromote && (
                              <button type="button" className="btn-ghost btn-sm" disabled={busy} title="knock-out 통과 — Short List로 승격" onClick={() => shortlist(t.id)}>승격</button>
                            )}
                            {t.status === "shortlisted" && (
                              <span role="group" aria-label="Short List 순위 조정" className="flex items-center gap-0.5">
                                <button type="button" className="btn-ghost btn-sm" disabled={busy || orderIdx <= 0} aria-label={`${t.company_name} 순위 올리기`} onClick={() => rerank(t.id, "up")}>↑</button>
                                <button type="button" className="btn-ghost btn-sm" disabled={busy || orderIdx < 0 || orderIdx >= shortlistOrder.length - 1} aria-label={`${t.company_name} 순위 내리기`} onClick={() => rerank(t.id, "down")}>↓</button>
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="text-[0.75rem] text-[color:var(--muted-fg)]">{t.exclusion_reason ?? "—"}</td>
                      </tr>
                      {isOpen && (
                        <tr key={`${t.id}-detail`}>
                          <td colSpan={6}>
                            <div className="text-[0.78rem] py-1">
                              <h4 className="text-[0.85rem] mb-2">S7 스크리닝 — chk-target-screening (t-01~t-09)</h4>
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
                ? "knock-out 통과 후보 0건 — Target Screening 진행 KILL 기준 검토가 필요합니다 (flow.spec S7 kill criteria)."
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
