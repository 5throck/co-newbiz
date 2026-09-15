"use client";

import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { StageFrame } from "../../components/StageFrame.tsx";
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
  eval_summary?: { financial: { score: number | null }; technical: { score: number | null }; combined: number | null };
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

// 위원회 심의(target-longlist-shortlist-committee) 판정 근거 — t-01~09 스크리닝
// 결과를 후보별 표로 압축해 소집 topic에 붙인다(사용자 요청, 2026-09-15).
// 제외된 후보는 뺀다(이미 Long List에서 걸러졌으므로 심의 대상이 아니다).
// 프롬프트 비대화 방지로 최대 12개 후보 × 9개 항목만 담는다.
function buildScreeningBriefMd(targets: TargetRow[], checklist: ChecklistItem[]): string | undefined {
  const candidates = targets.filter((t) => t.status !== "excluded").slice(0, 12);
  if (candidates.length === 0 || checklist.length === 0) return undefined;
  const header = `| 후보 | ${checklist.map((c) => c.id).join(" | ")} |`;
  const sep = `| --- | ${checklist.map(() => "---").join(" | ")} |`;
  const rows = candidates.map((t) => {
    const states = t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>) : {};
    return `| ${t.company_name} | ${checklist.map((c) => VERDICT_KO[states[c.id] ?? "pending"]).join(" | ")} |`;
  });
  return [header, sep, ...rows].join("\n").slice(0, 4000);
}

// mockup baseline-v5.html의 S6/S7은 탭으로 나뉘지 않은 단일 연속 화면이다
// (Universe 정의 → 후보 발굴 → Long List(판정·랭킹·Short List) → 위원회 심의
// → 게이트, 전부 한 페이지). 탭을 없애고 흐름 배너는 섹션으로 스크롤 이동만
// 한다(사용자 요청, 2026-09-15).
const SECTION_IDS = { universe: "s6s7-universe", longlist: "s6s7-longlist", shortlist: "s6s7-shortlist" } as const;
function scrollToSection(key: keyof typeof SECTION_IDS) {
  document.getElementById(SECTION_IDS[key])?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function BrownfieldView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [opps, setOpps] = useState<OppRow[] | null>(null);
  const [selected, setSelected] = useState<OppDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTarget, setOpenTarget] = useState<string | null>(null);
  const [screeningDraft, setScreeningDraft] = useState<Record<string, string>>({});
  const [excludeReason, setExcludeReason] = useState<Record<string, string>>({});
  const [newTarget, setNewTarget] = useState({ company_name: "", dart_corp_code: "", universe_note: "" });
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

      {/* ── S6/S7 흐름 배너(mockup baseline-v5.html S6/S7 step-flow 차용) —
          누구와 결합할 것인가? 목표 시장 정의 → 후보 발굴 → 재무·기술 평가 →
          랭킹·Short List 승격 → 위원회 심의(t-01~09 판정 근거) → Target
          Screening 게이트. t-01~09 스크리닝은 별도 단계가 아니라 위원회
          심의의 판정 근거로만 쓴다(사용자 요청, 2026-09-15). 탭으로 나누지
          않은 단일 연속 화면(mockup 구조) — 각 단계는 해당 섹션으로 스크롤
          이동만 한다(사용자 요청, 2026-09-15). ── */}
      {selected && (
        <nav aria-label="S6/S7 진행 흐름" className="flex flex-wrap items-center gap-1 mb-3 text-[0.75rem]">
          {([
            ["①", "목표 시장 정의", "universe"],
            ["②", "후보 발굴", "longlist"],
            ["③", "재무·기술 평가", "longlist"],
            ["④", "랭킹·Short List 승격", "longlist"],
            ["⑤", "위원회 심의(t-01~09 판정)", "shortlist"],
            ["⑥", "Target Screening 게이트", "shortlist"],
          ] as const).map(([n, label, sectionKey], i) => (
            <span key={label} className="flex items-center gap-1">
              {i > 0 && <span className="text-[color:var(--muted-fg)]">→</span>}
              <button type="button" className="control-chip status-not-started" onClick={() => scrollToSection(sectionKey)}>
                {n} {label}
              </button>
            </span>
          ))}
        </nav>
      )}

      {/* ── 목표 시장 정의 (S6) — 보기(읽기 전용) / 수정(모달) 분리. mockup처럼
          탭 없이 항상 렌더링, 흐름 배너에서 스크롤로만 이동한다. ── */}
      {selected && (
        <div id={SECTION_IDS.universe} style={{ scrollMarginTop: "1rem" }}>
        <section aria-label="목표 시장 정의" className="market-section">
          <div className="sizing-grade-card">
            <div className="flex items-start justify-between gap-2 mb-2">
              <h4 className="text-[0.85rem] mb-0">목표 시장 정의</h4>
              {selected.universe && (
                <button type="button" className="btn-ghost btn-sm shrink-0" onClick={openUniverseEditor}>수정</button>
              )}
            </div>
            {selected.universe ? (
              <>
                <p className="mb-2 text-[0.78rem]">
                  커버리지:{" "}
                  <span className={`status-chip ${selected.targets.filter((t) => t.status !== "excluded").length >= (selected.universe.min_long_list ?? 5) ? "status-green" : "status-amber"}`}>
                    Long List {selected.targets.filter((t) => t.status !== "excluded").length} / 최소 {selected.universe.min_long_list ?? 5}
                  </span>
                </p>
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
        </div>
      )}

      {/* ── 목표 시장 정의 수정 모달 — 취소하면 어떤 값도 반영되지 않는다 ── */}
      {editingUniverse && (
        <div className="modal-backdrop" onClick={() => { if (!savingUniverse) closeUniverseEditor(); }}>
          <div className="modal-panel" role="dialog" aria-modal="true" aria-label="목표 시장 정의 수정" onClick={(e) => e.stopPropagation()}>
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
                  <p className="mb-2 text-[0.75rem] text-[color:var(--amber-fg, #b45309)]">{uniReco.note ?? "초안을 만들 수 없습니다."}</p>
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
          {/* ── S6 ② 후보 발굴 — 시장·기업 마스터 기반 제안 / 웹 검색·LLM 제안
              두 방식을 한 카드에 모은다(mockup baseline-v5.html S6/S7 card② 차용).
              수용하면 discovery_source가 후보별로 기록된다. ── */}
          <div className="sizing-grade-card mb-3">
            <h4 className="text-[0.85rem] mb-2">후보 발굴 — Long List 채우기</h4>
            <div className="flex flex-wrap gap-2 mb-2">
              <button
                type="button"
                className={`btn-ghost btn-sm ${discoveryPanel === "master" ? "control-chip status-green" : ""}`}
                onClick={() => setDiscoveryPanel(discoveryPanel === "master" ? null : "master")}
              >
                시장·기업 마스터 기반 제안{proposals && proposals.length > 0 ? ` (${proposals.length})` : ""}
              </button>
              <button
                type="button"
                className={`btn-ghost btn-sm ${discoveryPanel === "web" ? "control-chip status-green" : ""}`}
                onClick={() => {
                  setDiscoveryPanel(discoveryPanel === "web" ? null : "web");
                  if (webProposals === null) void generateWebProposals();
                }}
              >
                웹 검색·LLM 제안 <span className="status-chip status-amber ml-1">LLM 제안 라벨</span>
              </button>
            </div>

            {discoveryPanel === "master" && (
              <div className="mb-2">
                {proposals === null ? (
                  <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">불러오는 중...</p>
                ) : proposals.length === 0 ? (
                  <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">제안 가능한 신규 후보가 없습니다 — 직접 등록하거나 웹 검색 제안을 시도하세요.</p>
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

            {discoveryPanel === "web" && (
              <div className="mb-2">
                <p className="mb-2 text-[0.78rem] text-[color:var(--muted-fg)]">
                  실시간 웹 검색으로 근거를 찾고, 그 근거에 등장하는 회사만 후보로 제안합니다 (ADR-0118 §5 — 근거 없는
                  회사명은 만들지 않습니다. 검색을 쓸 수 없으면 LLM 자체 지식 기반 미검증 제안으로 대체됩니다).
                  각 후보는 출처와 신뢰도(A/B/C)를 함께 표시하며, "Long List에 등록"을 눌러야 등록됩니다 (경계 #2).
                </p>
                {webProposals === null ? (
                  <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">{webBusy ? "웹 검색·제안 생성 중..." : "불러오는 중..."}</p>
                ) : webProposals.length === 0 ? (
                  <p className="mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">{webNote ?? "제안할 후보가 없습니다 — 목표 시장 정의를 구체화한 뒤 다시 시도하세요."}</p>
                ) : (
                  <div>
                    <p className="mb-2 text-[0.75rem]">
                      <span className={`status-chip ${webSource === "llm" ? "status-green" : webSource === "llm_knowledge" ? "status-red" : "status-amber"}`}>
                        {webSource === "llm" ? "제안 · LLM (웹검색 근거)" : webSource === "llm_knowledge" ? "제안 · LLM (미검증, 근거 없음)" : "제안 · 결정론 폴백"}
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
            )}
          </div>

          {/* S6 — 후보 등록 (목표 시장 정의 근거 포함) */}
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
                <span className="block mb-1">목표 시장 근거 (선택)</span>
                <input value={newTarget.universe_note} onChange={(e) => setNewTarget({ ...newTarget, universe_note: e.target.value })} placeholder="후보 자격 기준·가치사슬 위치 등" className="sizing-new-input sizing-new-input-sm" />
              </label>
              <button type="submit" className="btn-ghost btn-sm" disabled={busy || !newTarget.company_name.trim()}>후보 등록</button>
            </div>
            <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
              S6 대상 후보 발굴 — 목표 시장 정의(후보 자격 기준·커버리지)를 기반으로 후보를 등록합니다.
              각 후보는 S7에서 <code>chk-target-screening</code>(t-01~t-09)로 스크리닝됩니다.
            </p>
          </form>

          {/* S7 선정 퍼널·게이트·위원회·승격은 아래 이어지는 섹션에서 계속된다
              (mockup처럼 탭 없이 한 화면 — 사용자 요청, 2026-09-15). */}

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
                  <th scope="col" title="재무·기술 평가(ADR-0139) 100점 가중 점수 — 충족 1점·부분충족 0.5점·미충족 0점을 가중평균, 예외(해당없음·예외)는 제외">재무·기술 평가</th>
                  <th scope="col" title="위 재무·기술 평가 종합 점수(financial·technical 평균) — Long List 잠정 순위(Short List rank와 별개)">잠정 순위</th>
                  <th scope="col" title="chk-target-screening t-01~t-09 판정 현황 — 충: 충족, 미: 미충족, 예: 예외, N: 해당없음 (위원회 심의의 판정 근거)">스크리닝 (t-01~09)</th>
                  <th scope="col">상태</th>
                  <th scope="col">제외 사유</th>
                </tr>
              </thead>
              <tbody>
                {displayedTargets.map((t) => {
                  const sm = t.screening_summary;
                  const isOpen = openTarget === t.id;
                  const states = t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>) : {};
                  const es = t.eval_summary;
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
                            onClick={() => {
                              const next = isOpen ? null : t.id;
                              setOpenTarget(next);
                              if (next && !evalItems[next]) loadEvalItems(next);
                              if (next && t.company_id && !(t.company_id in financials)) loadFinancials(t.company_id);
                            }}
                          >
                            {t.company_name}
                          </button>
                          {t.universe_note && <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">{t.universe_note}</span>}
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
                          <span className="flex items-center gap-0.5" aria-label={`스크리닝 ${sm ? `${sm.assessed}/${sm.total}` : `0/${selected.checklist.length}`}`}>
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
                          <td colSpan={7}>
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

                              {/* ── S7 재무·기술 평가 (ADR-0139) — chk-target-screening과 별도 레이어 ── */}
                              {(["financial", "technical"] as const).map((cat) => {
                                const items = (evalItems[t.id] ?? []).filter((it) => it.category === cat);
                                const nlKey = `${t.id}:${cat}`;
                                const catScore = evalScores[t.id]?.[cat];
                                return (
                                  <div key={cat} className="sizing-grade-card mt-3">
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                      <h4 className="text-[0.8rem] mb-0">{EVAL_CATEGORY_LABEL[cat]}</h4>
                                      <span
                                        className={`status-chip ${catScore?.score == null ? "status-not-started" : catScore.score >= 70 ? "status-green" : catScore.score >= 40 ? "status-amber" : "status-red"}`}
                                        title="충족 1점·부분충족 0.5점·미충족 0점을 항목 가중치로 가중평균 — 예외(해당없음·예외)는 계산에서 제외, 미판정 항목이 남아있으면 잠정치"
                                      >
                                        {catScore?.score == null ? "점수 — 판정 필요" : `${catScore.score}점 / 100점`}
                                      </span>
                                    </div>
                                    {catScore && catScore.totalWeight > catScore.scoredWeight && (
                                      <p className="mb-2 text-[0.72rem] text-[color:var(--muted-fg)]">
                                        미판정 가중치 {catScore.totalWeight - catScore.scoredWeight} / 전체 {catScore.totalWeight} 남음 — 전 항목 판정 전까지는 잠정 점수입니다.
                                      </p>
                                    )}
                                    {cat === "financial" && (
                                      <div className="mb-2 p-2 text-[0.72rem]" style={{ background: "var(--surface-1, rgba(0,0,0,0.03))", borderRadius: "0.5rem" }}>
                                        {!t.company_id ? (
                                          <p className="mb-0 text-[color:var(--muted-fg)]">회사 마스터 미연결 — 재무 데이터를 표시할 수 없습니다.</p>
                                        ) : financials[t.company_id] === undefined ? (
                                          <p className="mb-0 text-[color:var(--muted-fg)]">재무 데이터 불러오는 중...</p>
                                        ) : financials[t.company_id] === null ? (
                                          <p className="mb-0 text-[color:var(--muted-fg)]">재무 데이터를 불러오지 못했습니다.</p>
                                        ) : financials[t.company_id]!.financials.length === 0 ? (
                                          <>
                                            <p className="mb-1 text-[color:var(--muted-fg)]">DART 재무 데이터가 아직 동기화되지 않았습니다.</p>
                                            <button type="button" className="btn-ghost btn-sm" disabled={financialsSyncing === t.company_id} onClick={() => void syncFinancials(t.company_id!)}>
                                              {financialsSyncing === t.company_id ? "동기화 중..." : "재무 데이터 동기화"}
                                            </button>
                                          </>
                                        ) : (() => {
                                          const a = financials[t.company_id]!.analysis;
                                          const years = a.years;
                                          const seriesLine = (key: string, label: string) => {
                                            const s = a.series.find((x) => x.key === key);
                                            if (!s) return null;
                                            return `${label} ${s.points.map((p) => (p.value === null ? "—" : p.value.toLocaleString())).join(" → ")}억원`;
                                          };
                                          const latest = a.ratios[a.ratios.length - 1];
                                          return (
                                            <>
                                              {years.length > 0 && years.length < 5 && (
                                                <p className="mb-1 text-[color:var(--amber-fg,#b45309)]">데이터 부족 — {years.length}개년만 확인됨(5개년 미만).</p>
                                              )}
                                              <p className="mb-0.5">{seriesLine("revenue", "매출액")}</p>
                                              <p className="mb-0.5">{seriesLine("operatingProfit", "영업이익")}</p>
                                              <p className="mb-0.5">{seriesLine("totalDebt", "부채")}</p>
                                              {latest && (
                                                <p className="mb-0 text-[color:var(--muted-fg)]">
                                                  {latest.year} 참고 비율 — 영업이익률 {latest.operatingMargin != null ? `${(latest.operatingMargin * 100).toFixed(1)}%` : "—"} ·
                                                  {" "}순이익률 {latest.netMargin != null ? `${(latest.netMargin * 100).toFixed(1)}%` : "—"} ·
                                                  {" "}부채비율 {latest.debtRatio != null ? `${(latest.debtRatio * 100).toFixed(1)}%` : "—"}
                                                </p>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </div>
                                    )}
                                    {items.length === 0 ? (
                                      <p className="text-[0.75rem] text-[color:var(--muted-fg)] mb-2">
                                        {cat === "technical" ? "S3에 필요 역량이 정의되지 않아 기술 평가 항목이 없습니다 — 먼저 S3에서 정의하세요." : "불러오는 중..."}
                                      </p>
                                    ) : (
                                      <ul className="sizing-note-list mb-2">
                                        {items.map((it) => (
                                          <li key={it.id} className="flex flex-wrap items-start gap-2">
                                            <span className="flex-1 min-w-[14rem]">
                                              {it.label}
                                              {it.description && <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">{it.description}</span>}
                                            </span>
                                            {it.is_mandatory === 1 && <span className="status-chip status-amber">{it.source === "seeded" ? "S3 승계·필수" : "필수"}</span>}
                                            <label className="text-[0.72rem] text-[color:var(--muted-fg)] flex items-center gap-1" title="가중치 — 카테고리 100점 점수 계산 시 이 항목의 상대 비중">
                                              가중치
                                              <input
                                                type="number" min={1} step={1}
                                                aria-label={`${it.label} 가중치`}
                                                defaultValue={it.weight}
                                                disabled={evalBusy === it.id}
                                                onBlur={(e) => {
                                                  const v = Number(e.target.value);
                                                  if (v > 0 && v !== it.weight) void setEvalWeight(t.id, it.id, v);
                                                }}
                                                className="sizing-new-input sizing-new-input-sm"
                                                style={{ width: "4rem" }}
                                              />
                                            </label>
                                            <select
                                              aria-label={`${it.label} 판정`}
                                              value={it.state?.status ?? "pending"}
                                              disabled={evalBusy === it.id}
                                              onChange={(e) => void setEvalVerdict(t.id, it.id, e.target.value as "pending" | "pass" | "partial" | "fail" | "na" | "waived")}
                                              className="sizing-new-input sizing-new-input-sm"
                                            >
                                              <option value="pending">미판정</option>
                                              {EVAL_VERDICTS.map((v) => (
                                                <option key={v} value={v}>{VERDICT_KO[v]}</option>
                                              ))}
                                            </select>
                                            {it.is_deletable === 1 && (
                                              <button type="button" className="btn-ghost btn-sm" disabled={evalBusy === it.id} title="항목 삭제" onClick={() => void removeEvalCriterion(t.id, it.id)}>✕</button>
                                            )}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                    <div className="flex items-center gap-1">
                                      <input
                                        aria-label={`${EVAL_CATEGORY_LABEL[cat]} 항목 추가`}
                                        placeholder="+ 항목 추가"
                                        value={newCriterionLabel[nlKey] ?? ""}
                                        onChange={(e) => setNewCriterionLabel((prev) => ({ ...prev, [nlKey]: e.target.value }))}
                                        className="sizing-new-input sizing-new-input-sm"
                                        style={{ flex: "1 1 12rem" }}
                                      />
                                      <button type="button" className="btn-ghost btn-sm" disabled={evalBusy === nlKey || !(newCriterionLabel[nlKey] ?? "").trim()} onClick={() => void addEvalCriterion(t.id, cat)}>추가</button>
                                    </div>
                                  </div>
                                );
                              })}

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
        </div>
      )}

      {/* ── S7 선정 퍼널 + 게이트 결정 + 위원회 심의 + 승격(mockup 구조 —
          Long List 아래 이어서 렌더링, 탭 없음) ── */}
      {selected && (
        <div id={SECTION_IDS.shortlist} style={{ scrollMarginTop: "1rem" }}>
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
                  <p className="note mt-1 mb-0">S7 완료까지 — 판정 또는 제외가 남은 후보: {openTargets.map((t) => t.company_name).join(", ")} <span className="text-[color:var(--muted-fg)]">(판정은 위 Long List에서)</span></p>
                ) : (
                  <p className="note mt-1 mb-0">
                    모든 후보의 판정이 완료되었습니다 — 아래 위원회 심의(제안)와 target_screening 게이트 결정(사람)으로 Short List를 확정하세요.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[color:var(--muted-fg)] italic text-[0.85rem] mb-0">Long List 후보가 없습니다 — 위 Long List에서 후보를 등록하세요.</p>
            )}
          </section>

          {/* ── 인수 가능성 (참고용) — chk-target-screening t-01/t-02/t-08 발췌.
              공식 판정이 아니며 승격/추진을 막지 않는다(참고 표시일 뿐). ── */}
          {shortlistedTargets.length > 0 && (
            <section aria-label="인수 가능성" className="market-section">
              <h2 className="text-[0.9rem] mb-2">인수 가능성 <span className="note">— 참고용, 공식 판정 아님</span></h2>
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

          <GateDecisionPanel
            opportunityId={selected.opportunity.id}
            gates={["target_screening"]}
            killHint={
              selected.targets.length > 0 && !selected.targets.some((t) => t.status !== "excluded" && (t.screening_summary?.knockOutsPassed ?? false))
                ? "knock-out 통과 후보 0건 — Target Screening 진행 KILL 기준 검토가 필요합니다 (flow.spec S7 kill criteria)."
                : null
            }
          />
          {/* ADR-0097: target-longlist-shortlist-committee 심의 — 에이전트는 제안, 확정은 인간.
              위원회 판정 근거는 t-01~09(스크리닝)로 한다 — 랭킹에 쓰는 재무·기술
              평가와 역할을 분리한다(사용자 요청, 2026-09-15). */}
          {selected.targets.length > 0 && (
            <CommitteePanel
              opportunityId={selected.opportunity.id}
              committeeKey="target-longlist-shortlist-committee"
              committeeLabel="S6/S7 대상 롱리스트→숏리스트 위원회"
              gates={["screening"]}
              briefMd={buildScreeningBriefMd(selected.targets, selected.checklist)}
            />
          )}
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
