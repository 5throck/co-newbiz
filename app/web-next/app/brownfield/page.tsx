"use client";

import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { StageFrame } from "../../components/StageFrame.tsx";
import { SectionToolbar } from "../../components/layout.tsx";
import { GateDecisionPanel } from "../../components/GateDecisionPanel.tsx";
import { CommitteePanel } from "../../components/CommitteePanel.tsx";
import { PromotionPanel } from "../../components/PromotionPanel.tsx";
import { summarizeGap, type CapabilityGapRow } from "../../lib/capability-gap.ts";

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
  company_id: string | null;
  screening_summary?: { assessed: number; total: number; knockOutsPassed: boolean; anyKnockOutFail: boolean; mandatoryOpen: string[] };
  // 재무·기술 평가(ADR-0139) 기반 랭킹 점수 — 서버가 계산해 붙여준다.
  // 위원회 심의(t-01~09)와 역할을 분리한다(사용자 요청, 2026-09-15).
  eval_summary?: { financial: { score: number | null }; technical: { score: number | null }; combined: number | null; complete?: boolean };
}
// 재무 참고 패널 — GET /api/companies/[companyId]/financials 응답의 필요한 부분만.
interface FinancialsResp {
  financials: unknown[];
  analysis: {
    years: string[];
    series: Array<{ key: string; label: string; points: Array<{ year: string; value: number | null }> }>;
    ratios: Array<{ year: string; revenueGrowth?: number | null; operatingMargin?: number | null; netMargin?: number | null; debtRatio?: number | null }>;
  };
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
  source: "llm" | "llm_knowledge" | "synthesis";
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
// S7 재무·기술 평가 (ADR-0139) — chk-target-screening과 병행하는 별도 레이어.
// 항목별 weight(가중치)로 카테고리(재무/기술)마다 별도 100점 점수를 낸다 —
// 두 영역을 합치지 않는다(사용자 요구, 2026-09-15).
interface EvalItem {
  id: string; category: "financial" | "technical"; source: "builtin" | "seeded" | "custom";
  label: string; description: string | null; is_mandatory: 0 | 1; is_deletable: 0 | 1; weight: number;
  state: { status: "pending" | "pass" | "partial" | "fail" | "na" | "waived"; note: string | null } | null;
}
interface EvalCategoryScore { score: number | null; scoredWeight: number; totalWeight: number; excludedWeight: number }
const EVAL_CATEGORY_LABEL: Record<EvalItem["category"], string> = { financial: "재무적 평가", technical: "기술적 평가" };

const STATUS_LABEL: Record<TargetRow["status"], string> = { pending: "심사 중", shortlisted: "Short List", excluded: "제외" };
const VERDICTS = ["pass", "fail", "na", "waived"] as const;
// 재무·기술 평가(EvalItem) 전용 — chk-target-screening의 pass/fail knock-out과
// 달리 met/partial/unmet 3단계 + 예외(na/waived)로 가중 점수를 낸다.
const EVAL_VERDICTS = ["pass", "partial", "fail", "na", "waived"] as const;
const VERDICT_KO: Record<string, string> = { pass: "충족", partial: "부분충족", fail: "미충족", na: "해당없음", waived: "예외", pending: "미판정" };

// 위원회 심의(target-longlist-shortlist-committee) 판정 근거 — 후보별 재무·
// 기술 평가 100점 점수를 표로 압축해 소집 topic에 붙인다(2026-09-15).
// t-01~09 스크리닝 UI가 제거되어 더 이상 수집되지 않는 데이터는 근거로 쓰지
// 않는다. 제외된 후보는 뺀다. 프롬프트 비대화 방지로 최대 12개 후보만 담는다.
function buildEvalBriefMd(targets: TargetRow[]): string | undefined {
  const candidates = targets.filter((t) => t.status !== "excluded").slice(0, 12);
  if (candidates.length === 0) return undefined;
  const header = "| 후보 | 재무 점수 | 기술 점수 | 종합 점수 |";
  const sep = "| --- | --- | --- | --- |";
  const rows = candidates.map((t) => {
    const es = t.eval_summary;
    return `| ${t.company_name} | ${es?.financial.score ?? "—"} | ${es?.technical.score ?? "—"} | ${es?.combined ?? "—"} |`;
  });
  return [header, sep, ...rows].join("\n").slice(0, 4000);
}

// mockup baseline-v5.html의 S6/S7은 탭으로 나뉘지 않은 단일 연속 화면이다
// (Universe 정의 → 후보 발굴 → Long List(판정·랭킹·Short List) → 위원회 심의
// → 게이트, 전부 한 페이지). 탭을 없애고 흐름 배너는 섹션으로 스크롤 이동만
// 한다(사용자 요청, 2026-09-15).
const SECTION_IDS = { universe: "s6s7-universe", longlist: "s6s7-longlist", shortlist: "s6s7-shortlist" } as const;

export function BrownfieldView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [opps, setOpps] = useState<OppRow[] | null>(null);
  const [selected, setSelected] = useState<OppDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screeningDraft, setScreeningDraft] = useState<Record<string, string>>({});
  const [excludeReason, setExcludeReason] = useState<Record<string, string>>({});
  const [newTarget, setNewTarget] = useState({ company_name: "", dart_corp_code: "" });
  // S6 목표 시장 정의 — 완료기준(definition + 최소 Long List 커버리지).
  // 보기/수정 분리: 평소엔 저장된 값을 읽기 전용 카드로 보여주고, "수정" 클릭
  // 시 모달에서 편집한다 — 모달을 취소하면 어떤 값도 반영되지 않는다.
  const [universeDraft, setUniverseDraft] = useState({ definition: "", min_long_list: "5" });
  const [savingUniverse, setSavingUniverse] = useState(false);
  const [editingUniverse, setEditingUniverse] = useState(false);
  // 최소 후보 수 근거 입력 시 참고용으로만 보여주는 S3
  // 역량 갭 힌트(미보유·부분충족 건수). 공식으로 강제하지 않는다.
  const [gapHint, setGapHint] = useState<{ unmet: number; partial: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // 후보 발굴 카드(② — mockup 차용) — 두 제안 방식 중 열어본 쪽만 보여준다.
  const [discoveryPanel, setDiscoveryPanel] = useState<"master" | "web" | null>(null);
  // DART 회사 검색(등록 폼에 통합) — /api/synergy/dart-search 재사용(그룹/계열사
  // 화면과 동일 원천). 검색 결과를 클릭하면 등록 폼(newTarget)의 회사명·고유번호를
  // 채운다 — 별도 폼이 아니라 등록 폼의 보조 기능이다(사용자 요청, 2026-09-15).
  const [dartBusy, setDartBusy] = useState(false);
  const [dartResults, setDartResults] = useState<Array<{ corp_code: string; corp_name: string; source?: string; validated?: boolean | null }> | null>(null);
  const [dartError, setDartError] = useState<string | null>(null);
  // 모달 포커스 관리(ADR-0082 동반) — 웹검색 결과·목표 시장 정의 양쪽 모달에
  // 동일하게 적용한다(초기 포커스·Tab 트랩·ESC 닫기·포커스 복원).
  const webModalFocus = useModalFocus(() => { if (!webBusy) setDiscoveryPanel(null); });
  const universeModalFocus = useModalFocus(() => { if (!savingUniverse) closeUniverseEditor(); });

  const selectedId = searchParams.get("opportunity");
  interface Suggestion { id: string; name_ko: string; dart_corp_code: string | null }
  const [proposals, setProposals] = useState<Suggestion[] | null>(null);
  // B — Long List 웹검색 후보 제안 (ADR-0118: 제안만, 등록은 사람 클릭)
  const [webProposals, setWebProposals] = useState<WebSuggestion[] | null>(null);
  const [webBusy, setWebBusy] = useState(false);
  const [webNote, setWebNote] = useState<string | null>(null);
  const [webSource, setWebSource] = useState<"llm" | "llm_knowledge" | "synthesis" | null>(null);
  // D — 유니버스 선정 기준 초안
  const [uniReco, setUniReco] = useState<UniRecoResponse | null>(null);
  const [uniRecoApplied, setUniRecoApplied] = useState(false);
  const [uniBusy, setUniBusy] = useState(false);
  // E — 후보별 판정 초안 (targetId → 초안 메타)
  const [screeningReco, setScreeningReco] = useState<Record<string, { note: string; drafts: Record<string, ScreeningItemDraft> }>>({});
  const [screeningRecoBusy, setScreeningRecoBusy] = useState<string | null>(null);
  // S7 재무·기술 평가 (ADR-0139) — targetId → 카탈로그+판정 목록.
  const [evalItems, setEvalItems] = useState<Record<string, EvalItem[]>>({});
  // targetId → 카테고리별 100점 가중 점수(서버 계산, computeEvalScore).
  const [evalScores, setEvalScores] = useState<Record<string, Record<EvalItem["category"], EvalCategoryScore>>>({});
  const [evalBusy, setEvalBusy] = useState<string | null>(null);
  const [newCriterionLabel, setNewCriterionLabel] = useState<Record<string, string>>({});
  // DART 재무 참고 패널 — company_id(Long List 등록 시점부터 존재) 기준.
  const [financials, setFinancials] = useState<Record<string, FinancialsResp | null>>({});
  const [financialsSyncing, setFinancialsSyncing] = useState<string | null>(null);

  const loadProposals = useCallback(() => {
    if (!selectedId) { setProposals(null); return; }
    // opportunity-keyed 라우트 — 승격 전(S6 진행 중)에도 동작한다(구
    // /api/projects/[id] 키잉은 md_project가 없어 항상 404였던 버그).
    api.get<{ suggestions: Suggestion[] }>(`/api/brownfield/${encodeURIComponent(selectedId)}/target-proposals`)
      .then((r) => setProposals(r.data.suggestions))
      .catch(() => setProposals([]));
  }, [selectedId]);
  useEffect(() => { loadProposals(); }, [loadProposals]);

  async function searchDartCompanies(query: string) {
    const q = query.trim();
    if (!q || dartBusy) return;
    setDartBusy(true); setDartError(null);
    try {
      const r = await api.get<{ configured: boolean; results: Array<{ corp_code: string; corp_name: string; source?: string; validated?: boolean | null }>; error?: string }>(`/api/synergy/dart-search?q=${encodeURIComponent(q)}`);
      setDartResults(r.data.results);
      if (r.data.error) setDartError(r.data.error);
    } catch (err) {
      setDartError(err instanceof Error ? err.message : "DART 검색 실패");
    } finally {
      setDartBusy(false);
    }
  }

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

  // Long List 테이블의 재무·기술 평가 배지·잠정 순위는 서버가 계산해 target
  // row에 붙여주는 eval_summary를 그대로 쓴다(targets GET, ADR-0139) — 항목별
  // 편집 UI(evalItems)만 행을 펼칠 때 lazy 로드한다(loadEvalItems).

  async function saveUniverse() {
    if (!selected || savingUniverse || !universeDraft.definition.trim()) return;
    setSavingUniverse(true); setError(null);
    try {
      await api.put(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets`, {
        definition: universeDraft.definition.trim(),
        // criteria는 더 이상 이 화면에서 입력받지 않는다 — 서버가 기존 값을
        // 그대로 보존한다(생략 시 덮어쓰지 않음).
        min_long_list: Number(universeDraft.min_long_list) || 5,
      });
      loadDetail(selected.opportunity.id);
      setEditingUniverse(false);
      setUniReco(null);
      setUniRecoApplied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "목표 시장 정의 저장 실패");
    } finally {
      setSavingUniverse(false);
    }
  }

  function universeDraftFromSaved() {
    const u = selected?.universe;
    return {
      definition: u?.definition ?? "",
      min_long_list: String(u?.min_long_list ?? 5),
    };
  }

  // 수정 모달 열기 — 매번 저장된 값으로 새로 채운다(이전에 취소한 미저장
  // 입력이 남아있지 않도록). 참고용 S3 역량 갭 힌트도 함께 불러온다.
  function openUniverseEditor() {
    setUniverseDraft(universeDraftFromSaved());
    setUniReco(null);
    setUniRecoApplied(false);
    setEditingUniverse(true);
    if (selected) {
      api.get<{ rows: CapabilityGapRow[] }>(`/api/opportunities/${encodeURIComponent(selected.opportunity.id)}/capability-gap`)
        .then((r) => {
          const s = summarizeGap(r.data.rows);
          setGapHint({ unmet: s.unmet, partial: s.partial });
        })
        .catch(() => setGapHint(null));
    }
  }

  // 취소 — 입력값을 버리고 저장된 값으로 되돌린 뒤 모달을 닫는다. 저장 전까지는
  // 어떤 값도 반영되지 않는다(보기/수정 분리).
  function closeUniverseEditor() {
    setUniverseDraft(universeDraftFromSaved());
    setUniReco(null);
    setUniRecoApplied(false);
    setEditingUniverse(false);
  }

  // 목표 시장 정의 수정 폼 — 수정 모달 안에서만 쓰인다.
  function UniverseForm() {
    return (
      <form
        className="sizing-new-form mb-0"
        onSubmit={(e) => { e.preventDefault(); void saveUniverse(); }}
        aria-label="목표 시장 정의 수정"
      >
        <label className="text-[0.78rem] block mb-3">
          <span className="block mb-1">정의 * (후보 풀의 범위)</span>
          <textarea
            value={universeDraft.definition}
            onChange={(e) => setUniverseDraft({ ...universeDraft, definition: e.target.value })}
            placeholder="예: 국내 상장 로봇 부품·시스템 업체 전체"
            required
            rows={3}
            className="sizing-new-input w-full"
          />
        </label>
        <label className="text-[0.78rem] w-32 shrink-0 block mb-3">
          <span className="block mb-1">최소 후보 수</span>
          <input type="number" min={1} value={universeDraft.min_long_list} onChange={(e) => setUniverseDraft({ ...universeDraft, min_long_list: e.target.value })} className="sizing-new-input sizing-new-input-sm w-full" />
        </label>
        {gapHint && (
          <p className="mb-3 text-[0.72rem] text-[color:var(--muted-fg)]">
            참고(강제 공식 아님): S3 필요 역량 중 미보유 {gapHint.unmet}건 · 부분충족 {gapHint.partial}건
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={closeUniverseEditor} disabled={savingUniverse}>취소</button>
          <button type="submit" className="btn-ghost btn-sm" disabled={savingUniverse || !universeDraft.definition.trim()}>
            {savingUniverse ? "저장 중..." : "목표 시장 저장"}
          </button>
        </div>
      </form>
    );
  }

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // 기회를 바꾸면 진행 중이던 수정을 닫는다 — 다른 기회의 미저장 입력이 새
  // 기회 폼에 남지 않도록.
  useEffect(() => {
    setEditingUniverse(false);
    setUniReco(null);
    setUniRecoApplied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.opportunity.id]);

  const openOpportunity = useCallback((o: OppRow) => {
    router.replace(`/brownfield?opportunity=${encodeURIComponent(o.id)}`, { scroll: false });
    loadDetail(o.id);
  }, [loadDetail, router]);

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
      setUniRecoApplied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "정의 초안 생성 실패");
    } finally {
      setUniBusy(false);
    }
  }

  // 적용 — 아래 목표 시장 정의 폼의 "정의" 필드만 채운다(저장은 사람이 "목표
  // 시장 저장" 클릭). 산업/지역/규모 요약은 참고용일 뿐 자동으로 선정 기준·
  // 최소 후보 수 입력에 밀어넣지 않는다 — 그 두 값은 사람이 이미 정한 값을
  // 그대로 유지한다.
  function applyUniReco(c: UniCriteria) {
    const content = c.rationale || [c.industry, c.region, c.size].filter(Boolean).join(" · ");
    if (!content) return;
    setUniverseDraft((prev) => ({ ...prev, definition: content }));
    setUniRecoApplied(true);
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

  // S7 재무·기술 평가 (ADR-0139) — 후보 행을 펼칠 때 불러온다(최초 호출 시
  // 서버가 재무 빌트인·기술 시딩을 lazy하게 채운다).
  function loadEvalItems(targetId: string) {
    if (!selected) return;
    api.get<{ items: EvalItem[]; scores: Record<EvalItem["category"], EvalCategoryScore> }>(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets/${encodeURIComponent(targetId)}/eval-state`)
      .then((r) => {
        setEvalItems((prev) => ({ ...prev, [targetId]: r.data.items }));
        setEvalScores((prev) => ({ ...prev, [targetId]: r.data.scores }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "재무·기술 평가 불러오기 실패"));
  }

  async function setEvalVerdict(targetId: string, criterionId: string, status: "pending" | "pass" | "partial" | "fail" | "na" | "waived") {
    if (!selected) return;
    setEvalBusy(criterionId);
    try {
      await api.put(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets/${encodeURIComponent(targetId)}/eval-state/${encodeURIComponent(criterionId)}`, { status });
      loadEvalItems(targetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "평가 판정 저장 실패");
    } finally {
      setEvalBusy(null);
    }
  }

  async function setEvalWeight(targetId: string, criterionId: string, weight: number) {
    if (!selected || !Number.isFinite(weight) || weight <= 0) return;
    setEvalBusy(criterionId);
    try {
      await api.patch(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/eval-criteria/${encodeURIComponent(criterionId)}`, { weight });
      loadEvalItems(targetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "가중치 저장 실패");
    } finally {
      setEvalBusy(null);
    }
  }

  async function addEvalCriterion(targetId: string, category: EvalItem["category"]) {
    if (!selected) return;
    const key = `${targetId}:${category}`;
    const label = newCriterionLabel[key]?.trim();
    if (!label) return;
    setEvalBusy(key);
    try {
      await api.post(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/eval-criteria`, { category, label });
      setNewCriterionLabel((prev) => ({ ...prev, [key]: "" }));
      loadEvalItems(targetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "평가 항목 추가 실패");
    } finally {
      setEvalBusy(null);
    }
  }

  function loadFinancials(companyId: string) {
    api.get<FinancialsResp>(`/api/companies/${encodeURIComponent(companyId)}/financials`)
      .then((r) => setFinancials((prev) => ({ ...prev, [companyId]: r.data })))
      .catch(() => setFinancials((prev) => ({ ...prev, [companyId]: null })));
  }

  async function syncFinancials(companyId: string) {
    setFinancialsSyncing(companyId);
    try {
      await api.post(`/api/companies/${encodeURIComponent(companyId)}/sync`, {});
      loadFinancials(companyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "재무 데이터 동기화 실패");
    } finally {
      setFinancialsSyncing(null);
    }
  }

  async function removeEvalCriterion(targetId: string, criterionId: string) {
    if (!selected) return;
    setEvalBusy(criterionId);
    try {
      await api.delete(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/eval-criteria/${encodeURIComponent(criterionId)}`);
      loadEvalItems(targetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "평가 항목 삭제 실패");
    } finally {
      setEvalBusy(null);
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
      });
      setNewTarget({ company_name: "", dart_corp_code: "" });
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

  const targets = selected?.targets ?? [];
  const shortlistedTargets = targets.filter((t) => t.status === "shortlisted");
  // Long List(심사 중) 구간만 재무·기술 평가 종합 점수로 잠정 정렬한다 —
  // Short List 승격 후 순위(rank)는 사람이 손으로 조정하는 영역이라 건드리지
  // 않는다(status가 다르면 비교 없이 0을 반환해 안정 정렬로 원래 그룹 순서를
  // 보존한다).
  const displayedTargets = targets
    .slice()
    .sort((a, b) => {
      if (a.status !== "pending" || b.status !== "pending") return 0;
      return (b.eval_summary?.combined ?? -1) - (a.eval_summary?.combined ?? -1);
    });
  // 잠정 순위 번호는 pending(Long List) 구간에서만 1부터 매긴다 — displayedTargets
  // 배열 인덱스를 그대로 쓰면 앞쪽 Short List 행 개수만큼 밀린다.
  const pendingRank = new Map(targets.filter((t) => t.status === "pending")
    .slice()
    .sort((a, b) => (b.eval_summary?.combined ?? -1) - (a.eval_summary?.combined ?? -1))
    .map((t, i) => [t.id, i + 1]));
  const shortlistOrder = shortlistedTargets.map((t) => t.id);

  return (
    <main>
      <StageFrame stageId={["S6", "S7"]} track="brownfield" heading="S6/S7 대상발굴·선정">
        Brownfield 경로 — 진출방식이 Brownfield로 결정된 기회의
        대상 후보를 발굴하고(S6 Long List), <code>chk-target-screening</code> 체크리스트로 스크리닝해
        Short List로 좁힙니다(S7). CDD/TDD는 Short List 확정 후 S9에서 수행합니다.
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── Brownfield 기회 (칩) ── */}
      <section aria-label="브라운필드 기회" className="market-section">
        <SectionToolbar title="Brownfield로 결정된 기회" count={opps?.length} />
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

      {/* ── 목표 시장 정의 (S6) — 보기(읽기 전용) / 수정(모달) 분리. mockup처럼
          탭 없이 항상 렌더링, 흐름 배너에서 스크롤로만 이동한다. ── */}
      {selected && (
        <div id={SECTION_IDS.universe} className="grid gap-3 items-stretch md:grid-cols-[1fr_1fr]" style={{ scrollMarginTop: "1rem" }}>
        <section aria-label="목표 시장 정의" className="market-section mb-0 flex flex-col">
          <SectionToolbar
            title="목표 시장 정의"
            actions={selected.universe && <button type="button" className="btn-ghost btn-sm shrink-0" onClick={openUniverseEditor}>수정</button>}
          />
          <div className="sizing-grade-card flex-1">
            {selected.universe ? (
              <>
                {selected.universe.scope && <p className="mb-1 text-[0.78rem] text-[color:var(--muted-fg)]">커버리지 범위: {selected.universe.scope}</p>}
                <p className="mb-2 text-[0.85rem]">{selected.universe.definition}</p>
              </>
            ) : (
              <>
                <p className="mb-2 text-[0.8rem] text-[color:var(--muted-fg)]">
                  아직 정의되지 않았습니다 — S6 완료기준입니다. 후보 등록 전에 후보 자격 기준(Long List 범위)과 최소 커버리지를 확정하세요. Long List를 Short List로 좁히는 실제 평가는 S7의 재무·기술 평가에서 이뤄집니다.
                </p>
                <button type="button" className="btn-ghost btn-sm" onClick={openUniverseEditor}>목표 시장 정의 시작</button>
              </>
            )}
          </div>
        </section>

        {/* ── S6 ② 후보 발굴 — 시장·기업 마스터 기반 제안 / 웹 검색·LLM 제안
            두 방식을 한 카드에 모은다(mockup baseline-v5.html S6/S7 card② 차용).
            목표 시장 정의 옆에 좌/우로 배치한다(사용자 요청, 2026-09-15). ── */}
        <section aria-label="후보 발굴" className="market-section mb-0 flex flex-col">
          <SectionToolbar title="후보 발굴 — Long List 채우기" />
          <div className="sizing-grade-card flex-1">
            <div className="flex flex-wrap gap-2 mb-2">
              <button
                type="button"
                className={`btn-ghost btn-sm ${discoveryPanel === "master" ? "control-chip status-green" : ""}`}
                onClick={() => setDiscoveryPanel(discoveryPanel === "master" ? null : "master")}
              >
                시장·기업 마스터{proposals && proposals.length > 0 ? ` (${proposals.length})` : ""}
              </button>
              <button
                type="button"
                className={`btn-ghost btn-sm ${discoveryPanel === "web" ? "control-chip status-green" : ""}`}
                onClick={() => {
                  setDiscoveryPanel("web");
                  if (webProposals === null) void generateWebProposals();
                }}
              >
                웹검색{webProposals && webProposals.length > 0 ? ` (${webProposals.length})` : ""}
              </button>
            </div>

            {/* 등록 폼 + DART 검색 통합(사용자 요청, 2026-09-15) — 회사명을 입력하고
                "DART 검색"으로 찾은 결과를 클릭하면 회사명·고유번호가 폼에 채워진다.
                DART에 없는(비상장 등) 회사는 그대로 직접 입력해 등록할 수 있다.
                dart_corp_code가 채워진 채 등록되면 상세 화면의 DART 정보(재무
                facts·공시)가 바로 활성화된다. */}
            <form onSubmit={addTarget} className="sizing-new-form mb-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[0.78rem]" style={{ flex: "1 1 14rem" }}>
                  <span className="block mb-1">후보 회사명 * (Long List)</span>
                  <input
                    value={newTarget.company_name}
                    onChange={(e) => { setNewTarget({ ...newTarget, company_name: e.target.value }); setDartResults(null); }}
                    placeholder="예: 레인보우로보틱스"
                    required
                    className="sizing-new-input w-full"
                  />
                </label>
                <label className="text-[0.78rem]" style={{ flex: "1 1 11rem" }}>
                  <span className="block mb-1">DART 고유번호 (선택, 8자리)</span>
                  <input value={newTarget.dart_corp_code} onChange={(e) => setNewTarget({ ...newTarget, dart_corp_code: e.target.value })} placeholder="검색 결과 선택 또는 직접 입력" className="sizing-new-input sizing-new-input-sm w-full" />
                </label>
                <button
                  type="button"
                  className="btn-ghost btn-sm whitespace-nowrap shrink-0"
                  disabled={dartBusy || !newTarget.company_name.trim()}
                  onClick={() => void searchDartCompanies(newTarget.company_name)}
                >
                  {dartBusy ? "검색 중..." : "DART 검색"}
                </button>
                <button type="submit" className="btn-premium btn-sm shrink-0" disabled={busy || !newTarget.company_name.trim()}>후보 등록</button>
              </div>
              {dartError && <p className="mt-1 mb-0 text-[0.75rem] text-[color:var(--muted-fg)]">{dartError}</p>}
              {dartResults !== null && dartResults.length === 0 && !dartError && (
                <p className="mt-1 mb-0 text-[0.75rem] text-[color:var(--muted-fg)]">DART 검색 결과가 없습니다 — 비상장 등 미등록 회사라면 위 필드에 직접 입력해 등록하세요.</p>
              )}
              {dartResults !== null && dartResults.length > 0 && (
                <ul className="sizing-note-list mt-1">
                  {dartResults.map((r) => (
                    <li key={r.corp_code} className="flex flex-wrap items-center gap-2">
                      <code className="dd-item-id">{r.corp_code}</code>
                      <span className="flex-1 min-w-[12rem] text-[0.8rem]">{r.corp_name}</span>
                      {r.source === "web" ? (
                        <span className="status-chip status-amber" title="DART 직접 조회 실패 시 웹 검색으로 수집된 미검증 후보">웹 수집</span>
                      ) : (
                        <span className="status-chip status-green" title={r.source === "local" ? "기업 마스터" : "DART 기업목록 조회"}>검증</span>
                      )}
                      <button
                        type="button"
                        className="btn-ghost btn-sm whitespace-nowrap"
                        aria-pressed={newTarget.dart_corp_code === r.corp_code}
                        onClick={() => { setNewTarget((prev) => ({ ...prev, company_name: r.corp_name, dart_corp_code: r.corp_code })); setDartResults(null); }}
                      >
                        {newTarget.dart_corp_code === r.corp_code ? "✔ 선택됨" : "이 회사로 채우기"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </form>

            {discoveryPanel === "master" && (
              <div className="mb-2">
                {proposals === null ? (
                  <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">불러오는 중...</p>
                ) : proposals.length === 0 ? (
                  <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">제안 가능한 신규 후보가 없습니다 — 직접 등록하거나 웹검색 제안을 시도하세요.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {proposals.map((c) => (
                      <button key={c.id} type="button" className="control-chip"
                        title={c.dart_corp_code ? `DART ${c.dart_corp_code}` : undefined}
                        onClick={() => acceptProposal(c.name_ko, c.dart_corp_code)}>
                        ＋ {c.name_ko}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 mb-0 text-[0.7rem] text-[color:var(--muted-fg)]">수용 시 discovery_source=master_proposal로 기록됩니다.</p>
              </div>
            )}
          </div>
        </section>
        </div>
      )}

      {/* ── 웹검색 결과 모달 — 검색·선택을 한 화면에서 끝낸다(사용자 요청,
          2026-09-15). 제안 수용은 사람이 항목별로 클릭한다(경계 #2). ── */}
      {selected && discoveryPanel === "web" && (
        <div className="modal-backdrop" onClick={() => { if (!webBusy) setDiscoveryPanel(null); }} onKeyDown={webModalFocus.onKeyDown}>
          <div ref={webModalFocus.panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label="웹검색 후보 제안" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>웹검색 후보 제안</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setDiscoveryPanel(null)} disabled={webBusy} aria-label="닫기">닫기</button>
            </div>
            <p className="mb-2 text-[0.75rem] text-[color:var(--muted-fg)]">
              실시간 웹 검색으로 근거를 찾고, 그 근거에 등장하는 회사만 후보로 제안합니다 (ADR-0118 §5 — 근거 없는
              회사명은 만들지 않습니다). 검색을 쓸 수 없으면 LLM 자체 지식 기반 미검증 제안으로 대체됩니다.
              등록은 항목별 "Long List에 등록" 클릭으로만 이뤄집니다.
            </p>
            {webBusy && webProposals === null ? (
              <p className="my-4 text-center text-[0.85rem] text-[color:var(--muted-fg)]">웹 검색·제안 생성 중...</p>
            ) : webProposals !== null && webProposals.length === 0 ? (
              <>
                <p className="my-4 text-center text-[0.85rem] text-[color:var(--muted-fg)]">{webNote ?? "제안할 후보가 없습니다 — 목표 시장 정의를 구체화한 뒤 다시 시도하세요."}</p>
                <div className="flex justify-end">
                  <button type="button" className="btn-ghost btn-sm" disabled={webBusy} onClick={() => void generateWebProposals()}>다시 시도</button>
                </div>
              </>
            ) : (
              <>
                {webProposals !== null && (
                  <p className="mb-2 text-[0.75rem]">
                    <span className={`status-chip ${webSource === "llm" ? "status-green" : webSource === "llm_knowledge" ? "status-red" : "status-amber"}`}>
                      {webSource === "llm" ? "제안 · 웹검색 근거" : webSource === "llm_knowledge" ? "제안 · 미검증 (근거 없음)" : "제안 · 결정론 폴백"}
                    </span>
                    {webNote && <span className="ml-2 text-[color:var(--muted-fg)]">{webNote}</span>}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 mb-3" style={{ maxHeight: "60vh", overflowY: "auto" }}>
                  {(webProposals ?? []).map((s) => (
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
                      <span className="flex items-center gap-1 mt-1">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={webBusy}
                          onClick={() => void acceptProposal(s.company_name, s.dart_corp_code ?? null, "web_proposal", `웹 검색 제안 — ${s.rationale.slice(0, 80)} (출처: ${s.sources[0]?.url ?? "없음"})`)}
                        >
                          Long List에 등록
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          title="이 제안을 목록에서 지웁니다 — 등록하지 않고 무시(재생성 시 다시 나올 수 있음)"
                          onClick={() => setWebProposals((prev) => (prev ?? []).filter((p) => p.company_name !== s.company_name))}
                        >
                          무시
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-ghost btn-sm" disabled={webBusy} onClick={() => void generateWebProposals()}>
                    {webBusy ? "재생성 중..." : "다시 생성"}
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setDiscoveryPanel(null)}>닫기</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 목표 시장 정의 수정 모달 — 취소하면 어떤 값도 반영되지 않는다 ── */}
      {editingUniverse && (
        <div className="modal-backdrop" onClick={() => { if (!savingUniverse) closeUniverseEditor(); }} onKeyDown={universeModalFocus.onKeyDown}>
          <div ref={universeModalFocus.panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label="목표 시장 정의 수정" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>목표 시장 정의 수정</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={closeUniverseEditor} disabled={savingUniverse} aria-label="닫기">닫기</button>
            </div>
            <p className="mb-3 text-[0.72rem] text-[color:var(--muted-fg)]">저장하기 전까지는 아무 값도 반영되지 않습니다.</p>

            {/* D — 선정 기준 LLM 초안. 적용은 아래 정의 입력에 바로 반영되고,
                선정 기준·최소 후보 수는 사람이 정한 값을 그대로 둔다. */}
            <div className="sizing-grade-card mb-3">
              <h4 className="text-[0.8rem] mb-2">
                정의 초안 생성 <span className="status-chip status-amber">제안 · LLM</span>
              </h4>
              <p className="mb-2 text-[0.75rem] text-[color:var(--muted-fg)]">
                S1 시장분석 + S3 필요 역량 산출물을 근거로 정의 문구 초안을 제안합니다. "적용"은 아래 <b>정의</b> 입력만 채웁니다 —
                후보 자격 기준·최소 후보 수는 그대로 유지되며, 실제 저장은 "목표 시장 저장" 버튼(사람 클릭)으로 확정됩니다 (경계 #2).
              </p>
              {uniReco === null ? (
                <button type="button" className="btn-ghost btn-sm" disabled={uniBusy} onClick={() => void generateUniReco()}>
                  {uniBusy ? "초안 생성 중..." : "정의 초안 생성"}
                </button>
              ) : uniReco.criteria ? (() => {
                const rationaleAlreadySaved = !!uniReco.criteria.rationale && uniReco.criteria.rationale.trim() === universeDraft.definition.trim();
                return (
                  <div>
                    <p className="mb-1 text-[0.75rem]">
                      <span className={`status-chip mr-1 ${uniRecoApplied ? "status-green" : "status-amber"}`}>{uniRecoApplied ? "적용됨" : "제안"}</span>
                      {uniReco.source === "llm" ? "LLM" : "결정론"}
                    </p>
                    <ul className="sizing-note-list mb-2">
                      {uniReco.criteria.industry && <li>산업: {uniReco.criteria.industry}</li>}
                      {uniReco.criteria.region && <li>지역: {uniReco.criteria.region}</li>}
                      {uniReco.criteria.size && <li>규모: {uniReco.criteria.size}</li>}
                    </ul>
                    {uniReco.criteria.rationale && (
                      rationaleAlreadySaved ? (
                        <p className="mb-2 text-[0.75rem] text-[color:var(--muted-fg)]">근거: 아래 정의 입력과 동일합니다.</p>
                      ) : (
                        <p className="mb-2 text-[0.75rem] text-[color:var(--muted-fg)]">근거: {uniReco.criteria.rationale}</p>
                      )
                    )}
                    <p className="mb-2 text-[0.7rem] text-[color:var(--muted-fg)]">이 제안이 본 산출물: {uniReco.manifest.join(" · ") || "(근거 없음)"}</p>
                    <div className="flex items-center gap-1">
                      <button type="button" className="btn-ghost btn-sm" disabled={rationaleAlreadySaved} onClick={() => applyUniReco(uniReco.criteria!)}>
                        {rationaleAlreadySaved ? "이미 반영됨" : uniRecoApplied ? "다시 적용" : "정의 입력에 적용"}
                      </button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => { setUniReco(null); setUniRecoApplied(false); }}>닫기</button>
                      <button type="button" className="btn-ghost btn-sm" disabled={uniBusy} onClick={() => void generateUniReco()}>{uniBusy ? "재생성 중..." : "재생성"}</button>
                    </div>
                  </div>
                );
              })() : (
                <div>
                  <p className="mb-2 text-[0.75rem] text-[color:var(--amber-fg)]">{uniReco.note ?? "초안을 만들 수 없습니다."}</p>
                  <button type="button" className="btn-ghost btn-sm" disabled={uniBusy} onClick={() => void generateUniReco()}>{uniBusy ? "재생성 중..." : "다시 시도"}</button>
                </div>
              )}
            </div>

            <UniverseForm />
          </div>
        </div>
      )}

      {selected && (
        <div id={SECTION_IDS.longlist} style={{ scrollMarginTop: "1rem" }}>
        {/* ── S6/S7: 후보 등록 + Long List + 스크리닝 ── */}
        <section aria-label="대상 후보 스크리닝" className="market-section">
          {/* 후보 등록 폼은 위 "후보 발굴" 카드에 항상 표시된다(사용자 요청,
              2026-09-15) — 시장·기업 마스터/웹 검색·LLM 제안과 나란히 묶인다. */}

          {/* S7 선정 퍼널·게이트·위원회·승격은 아래 이어지는 섹션에서 계속된다
              (mockup처럼 탭 없이 한 화면 — 사용자 요청, 2026-09-15). */}

          {/* Long List 테이블 — 목표 시장 정의·후보 발굴 카드와 같은 카드 표면으로
              감싸 화면 위계를 맞춘다(UX 정리, 2026-09-15). */}
          <SectionToolbar
            title="Long List → 판정 · 랭킹 → Short List"
            summary={<span className="text-[0.72rem] text-[color:var(--muted-fg)]">Long List {targets.length} · Short List {shortlistedTargets.length}</span>}
          />
          <div className="sizing-grade-card">
          {targets.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem] mb-0">Long List 후보가 없습니다 — 위에서 후보를 등록하세요.</p>
          ) : displayedTargets.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem] mb-0">해당 상태의 후보가 없습니다.</p>
          ) : (
            <table className="data-table" aria-label="Long List">
              <caption className="sr-only">Long List 후보 — 평가 점수·잠정 순위·상태</caption>
              <thead>
                <tr>
                  <th scope="col">후보</th><th scope="col">DART</th>
                  <th scope="col" title="재무·기술 평가(ADR-0139) 100점 가중 점수 — 충족 1점·부분충족 0.5점·미충족 0점을 가중평균, 예외(해당없음·예외)는 제외">재무·기술 평가</th>
                  <th scope="col" title="위 재무·기술 평가 종합 점수(financial·technical 평균) — Long List 잠정 순위(Short List rank와 별개)">잠정 순위</th>
                  <th scope="col">상태</th>
                  <th scope="col">제외 사유</th>
                </tr>
              </thead>
              <tbody>
                {displayedTargets.map((t) => {
                  const sm = t.screening_summary;
                  const es = t.eval_summary;
                  const orderIdx = shortlistOrder.indexOf(t.id);
                  const canPromote = t.status === "pending" && t.eval_summary?.complete === true;
                  return (
                    <Fragment key={t.id}>
                      <tr>
                        <td className="cell-primary">
                          <a
                            href={`/brownfield/targets/${encodeURIComponent(t.id)}`}
                            className="font-semibold text-[color:var(--fg)] underline-offset-2 hover:underline"
                            title="후보 상세 화면(판정·평가·DART 정보)으로 이동합니다"
                          >
                            {t.company_name}
                          </a>
                          {/* 발굴 근거(universe_note — 웹검색 제안 문구 등)는 테이블
                              가독성을 해치므로 표시하지 않는다(사용자 요청, 2026-09-15).
                              제외 사유만 별도 컬럼으로 남는다. */}
                        </td>
                        <td><code className="dd-item-id">{t.dart_corp_code ?? "—"}</code></td>
                        <td>
                          <span className="flex items-center gap-1">
                            <span className={`status-chip ${es?.financial.score == null ? "status-not-started" : es.financial.score >= 70 ? "status-green" : es.financial.score >= 40 ? "status-amber" : "status-red"}`} title="재무 평가 100점 가중 점수">
                              재무 {es?.financial.score ?? "—"}
                            </span>
                            <span className={`status-chip ${es?.technical.score == null ? "status-not-started" : es.technical.score >= 70 ? "status-green" : es.technical.score >= 40 ? "status-amber" : "status-red"}`} title="기술 평가 100점 가중 점수(S3 필요 역량 기준)">
                              기술 {es?.technical.score ?? "—"}
                            </span>
                          </span>
                        </td>
                        <td className="tabular-nums" title="재무·기술 평가 종합 점수(financial·technical 평균) 기준 잠정 순위 — Short List rank(사람이 조정)와 별개">
                          {t.status !== "pending" ? (
                            <span className="text-[color:var(--muted-fg)]">—</span>
                          ) : es?.combined != null ? (
                            <>#{pendingRank.get(t.id)} <span className="text-[color:var(--muted-fg)]">({es.combined}점)</span></>
                          ) : (
                            <span className="text-[color:var(--muted-fg)]">평가 필요</span>
                          )}
                        </td>
                        <td>
                          <span className="flex items-center gap-1">
                            <span className={`status-chip ${t.status === "shortlisted" ? "status-green" : t.status === "excluded" ? "status-red" : "status-not-started"}`}>
                              {STATUS_LABEL[t.status]}{t.status === "shortlisted" && t.rank ? ` #${t.rank}` : ""}
                            </span>
                            {canPromote && (
                              <button type="button" className="btn-ghost btn-sm" disabled={busy} title="재무·기술 평가 완료 — Short List로 승격" onClick={() => shortlist(t.id)}>승격</button>
                            )}
                            {t.status === "shortlisted" && (
                              <span role="group" aria-label="Short List 순위 조정" className="flex items-center gap-0.5">
                                <button type="button" className="btn-ghost btn-sm" disabled={busy || orderIdx <= 0} aria-label={`${t.company_name} 순위 올리기`} onClick={() => rerank(t.id, "up")}>↑</button>
                                <button type="button" className="btn-ghost btn-sm" disabled={busy || orderIdx < 0 || orderIdx >= shortlistOrder.length - 1} aria-label={`${t.company_name} 순위 내리기`} onClick={() => rerank(t.id, "down")}>↓</button>
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="text-[0.75rem] text-[color:var(--muted-fg)]">
                          {t.exclusion_reason ? (
                            <span className="inline-block max-w-[18rem] truncate align-bottom" title={t.exclusion_reason}>{t.exclusion_reason}</span>
                          ) : "—"}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
          </div>
        </section>
        </div>
      )}

      {/* ── S7 선정 퍼널 + 게이트 결정 + 위원회 심의 + 승격(mockup 구조 —
          Long List 아래 이어서 렌더링, 탭 없음) ── */}
      {selected && (
        <div id={SECTION_IDS.shortlist} className="mt-3 flex flex-col gap-3 items-stretch" style={{ scrollMarginTop: "1rem" }}>
          {/* ── 인수 가능성 (참고용) — chk-target-screening t-01/t-02/t-08 발췌.
              공식 판정이 아니며 승격/추진을 막지 않는다(참고 표시일 뿐). ── */}
          {shortlistedTargets.length > 0 && (
            <section aria-label="인수 가능성" className="market-section">
              <SectionToolbar title="인수 가능성" summary={<span className="note">— 참고용, 공식 판정 아님</span>} />
              {shortlistedTargets.map((t) => {
                const states = t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>) : {};
                const keyItems = selected.checklist.filter((it) => ["t-01", "t-02", "t-08"].includes(it.id));
                const concern = ["t-01", "t-02"].some((id) => states[id] === "fail");
                return (
                  <div key={t.id} className="sizing-grade-card mb-2">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <strong className="text-[0.85rem]">{t.company_name} {t.rank ? `· rank ${t.rank}` : ""}</strong>
                      {concern && <span className="status-chip status-red">인수 가능성 우려</span>}
                    </div>
                    <ul className="sizing-note-list mb-0">
                      {keyItems.map((it) => (
                        <li key={it.id} className="text-[0.75rem]">
                          <code className="dd-item-id mr-1">{it.id}</code>
                          {VERDICT_KO[states[it.id] ?? "pending"]}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          )}

          {/* ADR-0097: target-longlist-shortlist-committee 심의 — 에이전트는 제안, 확정은 인간.
              위원회 판정 근거는 t-01~09(스크리닝)로 한다 — 랭킹에 쓰는 재무·기술
              평가와 역할을 분리한다(사용자 요청, 2026-09-15). 위원회 심의(제안)가
              게이트 결정(사람) 위에 오도록 배치한다(사용자 요청, 2026-09-15). */}
          {selected.targets.length > 0 && (
            <CommitteePanel
              opportunityId={selected.opportunity.id}
              committeeKey="target-longlist-shortlist-committee"
              committeeLabel="S6/S7 대상 롱리스트→숏리스트 위원회"
              gates={["screening"]}
              briefMd={buildEvalBriefMd(selected.targets)}
            />
          )}
          <GateDecisionPanel
            opportunityId={selected.opportunity.id}
            gates={["target_screening"]}
            killHint={
              selected.targets.length > 0 && !selected.targets.some((t) => t.status !== "excluded" && t.eval_summary?.complete === true)
                ? "재무·기술 평가가 완료된 후보가 0건입니다 — Target Screening 진행 KILL 기준 검토가 필요합니다 (flow.spec S7 kill criteria)."
                : null
            }
          />
          <p className="text-[0.78rem] text-[color:var(--muted-fg)] mb-2">
            ↓ 위 Target Screening 게이트가 <b>GO</b>로 기록되어야 아래 프로젝트 추진이 가능합니다 — 승인 기록은 판단, 추진은 그 판단을 전제로 한 장부상 전환입니다.
          </p>
          {/* ADR-0095 — S7→S8 승격 표면: 완료 요건 충족 시 사람이 승격을 기록한다 */}
          <PromotionPanel
            opportunityId={selected.opportunity.id}
            heading={`${selected.opportunity.name} — 프로젝트로 추진 (Target Screening 승인 이후, S7 → S8)`}
          />
        </div>
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
