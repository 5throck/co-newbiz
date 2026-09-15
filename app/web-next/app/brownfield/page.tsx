"use client";

import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { GateDecisionPanel } from "../../components/GateDecisionPanel.tsx";
import { CommitteePanel } from "../../components/CommitteePanel.tsx";
import { PromotionPanel } from "../../components/PromotionPanel.tsx";
import { TabNav } from "../../components/TabNav.tsx";

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

// ── ADR-0118 제안 표면 (B: 웹검색 후보 · D: 유니버스 기준 · E: 판정 초안) ──
interface WebSuggestion {
  company_name: string;
  dart_corp_code?: string | null;
  rationale: string;
  sources: Array<{ title: string; url: string; snippet: string }>;
  reliability: "A" | "B" | "C";
}
interface WebProposalResponse {
  source: "llm" | "synthesis";
  provider: string;
  note: string | null;
  query_count: number;
  suggestions: WebSuggestion[];
}
interface UniCriteria {
  industry: string;
  region: string;
  size: string;
  rationale: string;
}
interface UniRecoResponse {
  source: "llm" | "synthesis";
  provider: string;
  note: string | null;
  criteria: UniCriteria | null;
  manifest: string[];
}
interface ScreeningItemDraft {
  verdict: "pass" | "fail" | "na" | "waived";
  rationale: string;
  source_url: string | null;
}
interface ScreeningDraftResponse {
  source: "llm" | "synthesis";
  provider: string;
  note: string | null;
  drafts: Record<string, ScreeningItemDraft>;
  manifest: string[];
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
  const router = useRouter();
  // ?tab= 동기화 — deal-structure/business-case 패턴(deep-linkable, refresh 유지).
  const tabParam = searchParams.get("tab");
  const initialTab = tabParam === "universe" || tabParam === "longlist" || tabParam === "shortlist" ? tabParam : "universe";
  const [tab, setTab] = useState<"universe" | "longlist" | "shortlist">(initialTab);
  const setTabParam = (key: string) => {
    if (key !== "universe" && key !== "longlist" && key !== "shortlist") return;
    setTab(key);
    router.replace(`/brownfield?opportunity=${encodeURIComponent(searchParams.get("opportunity") ?? "")}&tab=${key}`, { scroll: false });
  };
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
  // B — Long List 웹검색 후보 제안 (ADR-0118: 제안만, 등록은 사람 클릭)
  const [webProposals, setWebProposals] = useState<WebSuggestion[] | null>(null);
  const [webBusy, setWebBusy] = useState(false);
  const [webNote, setWebNote] = useState<string | null>(null);
  const [webSource, setWebSource] = useState<"llm" | "synthesis" | null>(null);
  // D — 유니버스 선정 기준 초안
  const [uniReco, setUniReco] = useState<UniRecoResponse | null>(null);
  const [uniBusy, setUniBusy] = useState(false);
  // E — 후보별 판정 초안 (targetId → 초안 메타)
  const [screeningReco, setScreeningReco] = useState<Record<string, { note: string; drafts: Record<string, ScreeningItemDraft> }>>({});
  const [screeningRecoBusy, setScreeningRecoBusy] = useState<string | null>(null);

  const loadProposals = useCallback(() => {
    if (!selectedId) { setProposals(null); return; }
    // opportunity-keyed 라우트 — 승격 전(S6 진행 중)에도 동작한다(구
    // /api/projects/[id] 키잉은 md_project가 없어 항상 404였던 버그).
    api.get<{ suggestions: Suggestion[] }>(`/api/brownfield/${encodeURIComponent(selectedId)}/target-proposals`)
      .then((r) => setProposals(r.data.suggestions))
      .catch(() => setProposals([]));
  }, [selectedId]);
  useEffect(() => { loadProposals(); }, [loadProposals]);

  async function acceptProposal(companyName: string, dartCorpCode: string | null, source: "master_proposal" | "web_proposal" = "master_proposal", universeNote?: string) {
    try {
      await api.post(`/api/brownfield/${encodeURIComponent(selectedId ?? "")}/target-proposals`, {
        company_name: companyName, dart_corp_code: dartCorpCode || undefined, discovery_source: source,
        universe_note: universeNote,
      });
      setProposals((prev) => (prev ?? []).filter((c) => c.name_ko !== companyName));
      setWebProposals((prev) => (prev ?? []).filter((c) => c.company_name !== companyName));
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
    // ?opportunity=·?tab= 둘 다 URL에 유지 — router.replace로 동기화(딥링크 가능).
    router.replace(`/brownfield?opportunity=${encodeURIComponent(o.id)}&tab=${tab}`, { scroll: false });
    loadDetail(o.id);
  }, [loadDetail, router, tab]);

  // ── B: Long List 웹검색 후보 제안 생성 (on-demand, ADR-0118) ──
  async function generateWebProposals() {
    if (!selected || webBusy) return;
    setWebBusy(true); setError(null);
    try {
      const res = await api.post<WebProposalResponse>(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/target-proposals/web-search`, {});
      setWebProposals(res.data.suggestions);
      setWebNote(res.data.note);
      setWebSource(res.data.source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "웹검색 제안 생성 실패");
    } finally {
      setWebBusy(false);
    }
  }

  // ── D: 유니버스 선정 기준 초안 생성 ──
  async function generateUniReco() {
    if (!selected || uniBusy) return;
    setUniBusy(true); setError(null);
    try {
      const res = await api.post<UniRecoResponse>(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/universe-criteria-draft`, {});
      setUniReco(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "선정 기준 초안 생성 실패");
    } finally {
      setUniBusy(false);
    }
  }

  // 적용 — UniverseForm 입력만 채운다(저장은 사람이 "Universe 저장" 클릭).
  function applyUniReco(c: UniCriteria) {
    setUniverseDraft((prev) => ({
      ...prev,
      criteria: [c.industry, c.region, c.size].filter(Boolean).join(", "),
    }));
    setUniReco(null);
  }

  // ── E: 후보별 판정 초안 생성 — 미판정 select만 채운다 ──
  async function generateScreeningDraft(targetId: string) {
    if (!selected || screeningRecoBusy) return;
    setScreeningRecoBusy(targetId); setError(null);
    try {
      const res = await api.post<ScreeningDraftResponse>(
        `/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets/${encodeURIComponent(targetId)}/screening-draft`,
        {},
      );
      setScreeningReco((prev) => ({ ...prev, [targetId]: { note: res.data.note ?? "", drafts: res.data.drafts ?? {} } }));
      // 미판정 항목만 초안값으로 미리 채운다 — 사람이 이미 판정한 값은 건드리지 않음.
      setScreeningDraft((prev) => {
        const n = { ...prev };
        for (const [itemId, d] of Object.entries(res.data.drafts ?? {})) {
          const key = `${targetId}:${itemId}`;
          const savedState = selected.targets.find((t) => t.id === targetId)?.screening_json;
          const already = savedState ? (JSON.parse(savedState) as Record<string, string>)[itemId] : undefined;
          if (already && already !== "pending") continue;
          if (n[key] && n[key] !== "pending") continue; // 사람이 이 세션에서 이미 판정한 값 유지
          n[key] = d.verdict;
        }
        return n;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "판정 초안 생성 실패");
    } finally {
      setScreeningRecoBusy(null);
    }
  }

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
      // 판정이 저장되면 LLM 초안 메타도 정리된다 — 이제 사람이 확정한 값이다.
      setScreeningReco((prev) => { const n = { ...prev }; delete n[targetId]; return n; });
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

      {/* ── S6/S7 섹션 탭 — 유니버스 정의 / Long List / Short List (?tab= 동기화) ── */}
      {selected && (
        <TabNav
          tabs={[
            { key: "universe", label: "유니버스 정의 (S6)" },
            { key: "longlist", label: "Long List", count: targets.length },
            { key: "shortlist", label: "Short List", count: shortlistedTargets.length },
          ]}
          active={tab}
          onSelect={setTabParam}
          label="S6/S7 화면 섹션"
        />
      )}

      {/* ── 유니버스 정의 탭 (S6) — Target Universe 정의 + 선정 기준 LLM 초안 ── */}
      {selected && tab === "universe" && (
        <section aria-label="유니버스 정의" className="market-section">
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

          {/* D — 유니버스 선정 기준 LLM 초안 (제안만, 적용은 폼 채움뿐 — 저장은 사람) */}
          <div className="sizing-grade-card">
            <h4 className="text-[0.85rem] mb-2">
              선정 기준 초안 생성 <span className="status-chip status-amber">제안 · LLM</span>
            </h4>
            <p className="mb-2 text-[0.78rem] text-[color:var(--muted-fg)]">
              S1 시장분석 + S3 필요 역량 산출물을 근거로 선정 기준 초안을 제안합니다. 제안은 근거가 될 뿐이며,
              "적용"은 정의 수정 폼을 채울 뿐 — 실제 저장은 위 "Universe 저장" 버튼(사람 클릭)으로 확정됩니다 (경계 #2).
            </p>
            {uniReco === null ? (
              <button type="button" className="btn-ghost btn-sm" disabled={uniBusy} onClick={() => void generateUniReco()}>
                {uniBusy ? "초안 생성 중..." : "선정 기준 초안 생성"}
              </button>
            ) : uniReco.criteria ? (
              <div>
                <p className="mb-1 text-[0.78rem]">
                  <span className="status-chip status-amber mr-1">제안</span>
                  {uniReco.source === "llm" ? "LLM" : "결정론"} — 적용하면 아래 내용이 정의 수정 폼의 선정 기준에 채워집니다.
                </p>
                <ul className="sizing-note-list mb-2">
                  {uniReco.criteria.industry && <li>산업: {uniReco.criteria.industry}</li>}
                  {uniReco.criteria.region && <li>지역: {uniReco.criteria.region}</li>}
                  {uniReco.criteria.size && <li>규모: {uniReco.criteria.size}</li>}
                </ul>
                {uniReco.criteria.rationale && <p className="mb-2 text-[0.78rem] text-[color:var(--muted-fg)]">근거: {uniReco.criteria.rationale}</p>}
                <p className="mb-2 text-[0.72rem] text-[color:var(--muted-fg)]">이 제안이 본 산출물: {uniReco.manifest.join(" · ") || "(근거 없음)"}</p>
                <div className="flex items-center gap-1">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => applyUniReco(uniReco.criteria!)}>적용 (정의 수정 폼에 반영)</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setUniReco(null)}>무시</button>
                  <button type="button" className="btn-ghost btn-sm" disabled={uniBusy} onClick={() => void generateUniReco()}>{uniBusy ? "재생성 중..." : "재생성"}</button>
                </div>
              </div>
            ) : (
              <div>
                <p className="mb-2 text-[0.78rem] text-[color:var(--amber-fg, #b45309)]">{uniReco.note ?? "초안을 만들 수 없습니다."}</p>
                <button type="button" className="btn-ghost btn-sm" disabled={uniBusy} onClick={() => void generateUniReco()}>{uniBusy ? "재생성 중..." : "다시 시도"}</button>
              </div>
            )}
          </div>
        </section>
      )}

      {selected && tab === "longlist" && (
        <>
      {/* ── S6 ② 후보 발굴 제안 (deterministic master-data 기반, provenance 기록) ── */}
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
          <p className="note" style={{ marginBottom: 0 }}>수용하면 발굴 출처(discovery_source)가 기록됩니다 — 위 제안은 결정론 소스이며, 아래 웹검색 제안은 web_proposal로 별도 기록됩니다.</p>

          {/* B — Long List 웹검색 후보 제안 (ADR-0118: 실검색 근거 기반, 등록은 사람) */}
          <div className="sizing-grade-card mt-3">
            <h4 className="text-[0.85rem] mb-2">
              Long List 웹검색 후보 제안 <span className="status-chip status-amber">제안 · 신규</span>
            </h4>
            <p className="mb-2 text-[0.78rem] text-[color:var(--muted-fg)]">
              실시간 웹 검색으로 근거를 찾고, 그 근거에 등장하는 회사만 후보로 제안합니다 (ADR-0118 §5 — 근거 없는
              회사명은 만들지 않습니다). 각 후보는 최소 1건의 출처 URL과 신뢰도(A/B/C)를 함께 표시하며,
              "Long List에 등록"을 눌러야 후보가 등록됩니다 (경계 #2).
            </p>
            {webProposals === null ? (
              <button type="button" className="btn-ghost btn-sm" disabled={webBusy} onClick={() => void generateWebProposals()}>
                {webBusy ? "웹 검색·제안 생성 중..." : "웹 검색 후보 제안 생성"}
              </button>
            ) : webProposals.length === 0 ? (
              <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">{webNote ?? "제안할 후보가 없습니다 — 유니버스 정의를 구체화한 뒤 다시 시도하세요."}</p>
            ) : (
              <div>
                <p className="mb-2 text-[0.75rem]">
                  <span className={`status-chip ${webSource === "llm" ? "status-green" : "status-amber"}`}>
                    {webSource === "llm" ? "제안 · LLM (웹검색 근거)" : "제안 · 결정론 폴백"}
                  </span>
                  {webNote && <span className="ml-2">{webNote}</span>}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                  {webProposals.map((s) => (
                    <div key={s.company_name} className="sizing-grade-card mb-0">
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-[0.85rem]">{s.company_name}</strong>
                        <span className="status-chip status-not-started" title="출처 도메인 신뢰도 — 정부·공시 A, 주요 언론·컨설팅 B, 기타 C">
                          신뢰도 {s.reliability}
                        </span>
                      </div>
                      <p className="mb-1 text-[0.78rem]">{s.rationale}</p>
                      {s.sources.slice(0, 2).map((src) => (
                        <a key={src.url} href={src.url} target="_blank" rel="noreferrer" className="block text-[0.72rem] text-[color:var(--accent)] underline truncate" title={src.title}>
                          출처: {src.url}
                        </a>
                      ))}
                      <button
                        type="button"
                        className="btn-ghost btn-sm mt-1"
                        onClick={() => void acceptProposal(s.company_name, s.dart_corp_code ?? null, "web_proposal", `웹 검색 제안 — ${s.rationale.slice(0, 80)} (출처: ${s.sources[0]?.url ?? "없음"})`)}
                      >
                        Long List에 등록
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn-ghost btn-sm" disabled={webBusy} onClick={() => void generateWebProposals()}>
                  {webBusy ? "재생성 중..." : "다시 생성"}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── S6/S7: 후보 등록 + Long List + 스크리닝 ── */}
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

          {/* 유니버스 정의는 "유니버스 정의 (S6)" 탭으로 이동했다. */}

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

          {/* S7 선정 퍼널·게이트·위원회·승격은 "Short List" 탭으로 이동했다 —
              이 탭(Long List)은 발굴·등록·판정 작업 화면, Short List 탭은
              결정/확정 화면이다. */}

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
                              {/* E — 판정 LLM 초안 (웹검색 근거 있는 항목만 채움, 저장은 사람) */}
                              <div className="flex flex-wrap items-center gap-2 mb-2">
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm"
                                  disabled={screeningRecoBusy !== null || busy}
                                  title="웹 검색으로 항목별 근거를 찾아 판정 초안을 채웁니다 — 근거 없는 항목은 미판정으로 남습니다"
                                  onClick={() => void generateScreeningDraft(t.id)}
                                >
                                  {screeningRecoBusy === t.id ? "초안 생성 중..." : "LLM 판정 초안 생성"}
                                </button>
                                {screeningReco[t.id]?.note && <span className="text-[0.75rem] text-[color:var(--muted-fg)]">{screeningReco[t.id].note}</span>}
                              </div>
                              <ul className="sizing-note-list">
                                {selected.checklist.map((item) => {
                                  const key = `${t.id}:${item.id}`;
                                  const current = screeningDraft[key] ?? (t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>)[item.id] : undefined) ?? "pending";
                                  const rec = screeningReco[t.id]?.drafts[item.id];
                                  const isLlmFilled = rec !== undefined && (screeningDraft[key] ?? "") === rec.verdict;
                                  return (
                                    <li key={item.id} className="flex flex-wrap items-start gap-2">
                                      <code className="dd-item-id mt-1">{item.id}</code>
                                      <span className="flex-1 min-w-[16rem]">
                                        {item.text}
                                        {isLlmFilled && (
                                          <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">
                                            <span className="status-chip status-amber mr-1">LLM 제안 · 미확정</span>
                                            {rec.rationale}
                                            {rec.source_url && (
                                              <>
                                              {" "}
                                              <a href={rec.source_url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">근거 링크</a>
                                              </>
                                            )}
                                          </span>
                                        )}
                                      </span>
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
        </>
      )}

      {/* ── Short List 탭 (S7) — 선정 퍼널 + 게이트 결정 + 위원회 심의 + 승격 ── */}
      {selected && tab === "shortlist" && (
        <>
          {/* S7 선정 퍼널 — Long List에서 Short List로 좁히는 과정을 한눈에
              보여준다. 완료기준(flow.spec S7): 모든 후보가 랭킹 점수 또는 제외
              사유를 갖는다. */}
          <section aria-label="S7 선정 현황" className="market-section">
            {targets.length > 0 ? (
              <div className="mb-0">
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
                  <p className="note mt-1 mb-0">S7 완료까지 — 판정 또는 제외가 남은 후보: {openTargets.map((t) => t.company_name).join(", ")} <span className="text-[color:var(--muted-fg)]">(판정은 Long List 탭에서)</span></p>
                ) : (
                  <p className="note mt-1 mb-0">
                    모든 후보의 판정이 완료되었습니다 — 아래 위원회 심의(제안)와 target_screening 게이트 결정(사람)으로 Short List를 확정하세요.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[color:var(--muted-fg)] italic text-[0.85rem] mb-0">Long List 후보가 없습니다 — Long List 탭에서 후보를 등록하세요.</p>
            )}
          </section>
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
