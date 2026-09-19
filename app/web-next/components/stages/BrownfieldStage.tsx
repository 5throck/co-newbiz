"use client";

// S6~S7 브라운필드 대상 경로 본문 — ADR-0120 Wave 2 Phase B 추출(/brownfield
// 페이지와 /deals/[id]/s6·s7 탭이 동일 컴포넌트를 소비한다). StageFrame·main
// 셸·기회 선택 칩은 호출자가 제공한다(공통 규칙 #6): 이 컴포넌트는 opportunityId
// 하나에 고정된 작업 화면(목표 시장 정의 → Long List → 사전 검토 → Short List →
// 게이트·위원회·승격)을 렌더링한다.
import { Fragment, useCallback, useEffect, useState } from "react";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { api } from "../../lib/api.ts";
import { SectionToolbar } from "../layout.tsx";
import { GateDecisionPanel } from "../GateDecisionPanel.tsx";
import { CommitteePanel } from "../CommitteePanel.tsx";
import { PromotionPanel } from "../PromotionPanel.tsx";
import { summarizeGap, type CapabilityGapRow } from "../../lib/capability-gap.ts";
import { precheckRecommendation, KNOCKOUT_IDS, SCREENING_VERDICT_KEYS, SCREENING_VERDICT_KO, normalizeVerdict } from "../../lib/brownfield-precheck.ts";

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
// 사전 검토 판정 초안(웹 검색 + 기확보 근거) — screening-draft 라우트 응답.
interface ScreeningItemDraft {
  verdict: "pass" | "fail" | "na" | "waived";
  rationale: string;
  source_url: string | null;
  kind?: "secured" | "web";
}
interface ScreeningDraftResponse {
  source: "llm" | "synthesis";
  provider: string;
  note: string | null;
  drafts: Record<string, ScreeningItemDraft>;
  manifest: string[];
}
// 사전 검토 인라인 판정 1건 — 판정값과 수집 근거(사유·출처·구분)를 함께 보관.
// 저장 시 evidence로 함께 보내 후보 상세 참고 저장소에 적립된다.
interface PrecheckDraftItem { verdict: string; rationale?: string; source_url?: string | null; kind?: string }
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
// 사전 검토(chk-target-screening) 판정 척도 — 5단 세분화(2026-09-16). 정의·
// 라벨·정규화는 lib/brownfield-precheck.ts(클라이언트 세이프 공용)에서 온다.

// 위원회 심의(target-longlist-shortlist-committee) 판정 근거 — 후보별 사전
// 검토(스크리닝 t-01~09) 판정 현황을 표로 압축해 소집 topic에 붙인다
// (사용자 요청 2026-09-15 · 2026-09-16 — 위원회 근거는 t-01~09, 랭킹에 쓰는
// 재무·기술 평가와 역할을 분리). 판정 기록은 이 화면 "사전 검토" 섹션에서
// 인라인으로 한다. 종합 점수는 참고로만 덧붙인다. 제외된 후보는 뺀다.
// 프롬프트 비대화 방지로 최대 12개 후보만 담는다.
function buildEvalBriefMd(targets: TargetRow[], checklist: ChecklistItem[], overrides?: Record<string, Record<string, PrecheckDraftItem>>): string | undefined {
  const candidates = targets.filter((t) => t.status !== "excluded").slice(0, 12);
  if (candidates.length === 0) return undefined;
  const ids = checklist.map((it) => it.id);
  if (ids.length === 0) return undefined;
  // 안건 — 위원회가 심의할 "요청된 결정"을 한눈에 알 수 있게 brief 최상단에
  // 명시한다(사용자 리포트, 2026-09-16: 무슨 안건인지 불명확).
  const agenda = [
    "# 안건 — Short List 최종 추천 여부 (Target Screening 게이트)",
    "",
    `대상 후보: ${candidates.map((t) => `${t.company_name}${t.rank ? ` (rank ${t.rank})` : ""}`).join(", ")}`,
    "요청 결정: 후보별로 chk-target-screening(t-01~t-09) 판정(아래 표 — 확정값과 확정 전 제안값 포함)과 재무·기술 평가 종합 점수를 근거로,",
    "추천 / 조건부 추천 / 보류(근거 부족) / 제외 검토 중 하나의 의사를 심의해 제안한다. 최종 게이트 결정(GO/HOLD/KILL)은 사람이 한다.",
  ].join("\n");
  const header = `| 후보 | ${ids.join(" | ")} | 판정 | 종합 점수 |`;
  const sep = `| --- |${" --- |".repeat(ids.length + 1)}`;
  let hasProposed = false;
  const rows = candidates.map((t) => {
    const saved = t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>) : {};
    const proposed = overrides?.[t.id] ?? {};
    const states: Record<string, string> = { ...saved };
    for (const [itemId, d] of Object.entries(proposed)) {
      if (d.verdict) {
        states[itemId] = d.verdict;
        if (!saved[itemId] || saved[itemId] === "pending") hasProposed = true;
      }
    }
    const verdicts = ids.map((id) => SCREENING_VERDICT_KO[normalizeVerdict(states[id])]);
    const assessed = ids.filter((id) => normalizeVerdict(states[id]) !== "pending").length;
    return `| ${t.company_name} | ${verdicts.join(" | ")} | ${assessed}/${ids.length} | ${t.eval_summary?.combined ?? "—"} |`;
  });
  const legend = "판정 척도: 충족(근거 명확)/충족(추정)/부분 충족/미충족/근거 부족/미판정 — t-01~09는 chk-target-screening 사전 검토(이 화면 Short List 섹션에서 기록). 종합 점수는 재무·기술 평가(랭킹용)로 위원회 근거와 역할이 다르다." + (hasProposed ? " ※ 일부 판정은 사람이 아직 확정 전인 위원회 제안값입니다." : "");
  return [agenda, "", header, sep, ...rows, "", legend].join("\n").slice(0, 4000);
}

// mockup baseline-v5.html의 S6/S7은 탭으로 나뉘지 않은 단일 연속 화면이다
// (Universe 정의 → 후보 발굴 → Long List(판정·랭킹·Short List) → 위원회 심의
// → 게이트, 전부 한 페이지). 탭을 없애고 흐름 배너는 섹션으로 스크롤 이동만
// 한다(사용자 요청, 2026-09-15).
const SECTION_IDS = { universe: "s6s7-universe", longlist: "s6s7-longlist", shortlist: "s6s7-shortlist" } as const;

export function BrownfieldStage({ opportunityId, onSaved }: { opportunityId: string; onSaved?: () => void }) {
  const [selected, setSelected] = useState<OppDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 사전 검토(chk-target-screening) 인라인 판정 — Short List 카드에서 바로 기록.
  // targetId → (itemId → 판정값 + 수집 근거). 근거는 저장 시 함께 보내 후보
  // 상세의 참고 저장소(screening_evidence_json, 0108)에 적립된다.
  const [precheckDraft, setPrecheckDraft] = useState<Record<string, Record<string, PrecheckDraftItem>>>({});
  const [precheckDraftNote, setPrecheckDraftNote] = useState<Record<string, string | null>>({});
  const [precheckBusy, setPrecheckBusy] = useState<string | null>(null);
  // 위원회 추천 검토 일괄 실행 상태
  const [recoBusy, setRecoBusy] = useState(false);
  const [recoProgress, setRecoProgress] = useState<string | null>(null);
  // 사전 검토 표 접힘 — 미완료면 기본 펼침, 전 후보 검토 완료면 기본 접음
  // (2026-09-18 리뷰: 하단 4블록이 항상 펼쳐 페이지가 지나치게 길었다).
  // null = 데이터 따름, 사용자가 토글하면 그 선택이 우선한다.
  const [precheckOpen, setPrecheckOpen] = useState<boolean | null>(null);
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
    if (!opportunityId) { setProposals(null); return; }
    // opportunity-keyed 라우트 — 승격 전(S6 진행 중)에도 동작한다(구
    // /api/projects/[id] 키잉은 md_project가 없어 항상 404였던 버그).
    api.get<{ suggestions: Suggestion[] }>(`/api/brownfield/${encodeURIComponent(opportunityId)}/target-proposals`)
      .then((r) => setProposals(r.data.suggestions))
      .catch(() => setProposals([]));
  }, [opportunityId]);
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
      await api.post(`/api/brownfield/${encodeURIComponent(opportunityId)}/target-proposals`, {
        company_name: companyName, dart_corp_code: dartCorpCode || undefined, discovery_source: source,
        universe_note: universeNote,
      });
      setProposals((prev) => (prev ?? []).filter((c) => c.name_ko !== companyName));
      setWebProposals((prev) => (prev ?? []).filter((c) => c.company_name !== companyName));
      loadDetail(opportunityId);
      onSaved?.();
    } catch (err) { setError(err instanceof Error ? err.message : "수용 실패"); }
  }

  const loadDetail = useCallback((oppId: string) => {
    api.get<OppDetail>(`/api/brownfield/${encodeURIComponent(oppId)}/targets`)
      .then((r) => { setSelected(r.data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "후보 목록 불러오기 실패"));
  }, []);

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
    if (!opportunityId) { setSelected(null); return; }
    loadDetail(opportunityId);
  }, [opportunityId, loadDetail]);

  // 기회를 바꾸면 진행 중이던 수정을 닫는다 — 다른 기회의 미저장 입력이 새
  // 기회 폼에 남지 않도록.
  useEffect(() => {
    setEditingUniverse(false);
    setUniReco(null);
    setUniRecoApplied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.opportunity.id]);

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
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보 등록 실패");
    } finally {
      setBusy(false);
    }
  }

  // ── 사전 검토(chk-target-screening) — Short List 후보의 최종 점검을 섹션
  // 카드에서 바로 기록한다(사용자 결정, 2026-09-16: 상세 화면·Long List의
  // 사전 검토 표면은 제거, 이 곳이 유일한 기록 지점). 저장은 기존
  // screening_json 병합 라우트 재사용 — 사람이 저장한 판정은 초안이 덮지 않는다.
  // 수집 근거(사유·출처·구분)는 evidence로 함께 보내 후보 참고 저장소에 적립.
  async function savePrecheck(targetId: string) {
    if (!selected || precheckBusy) return;
    const draft = precheckDraft[targetId];
    if (!draft || Object.keys(draft).length === 0) return;
    const states: Record<string, string> = {};
    const evidenceMeta: Record<string, { rationale?: string; source_url?: string | null; kind?: string }> = {};
    for (const [itemId, d] of Object.entries(draft)) {
      if (!d.verdict) continue;
      states[itemId] = d.verdict;
      evidenceMeta[itemId] = { rationale: d.rationale, source_url: d.source_url ?? null, kind: d.kind };
    }
    if (Object.keys(states).length === 0) return;
    setPrecheckBusy(targetId); setError(null);
    try {
      await api.post(`/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets/${encodeURIComponent(targetId)}`, { states, evidence: evidenceMeta });
      setPrecheckDraft((prev) => { const n = { ...prev }; delete n[targetId]; return n; });
      setPrecheckDraftNote((prev) => { const n = { ...prev }; delete n[targetId]; return n; });
      loadDetail(selected.opportunity.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "사전 검토 판정 저장 실패");
    } finally {
      setPrecheckBusy(null);
    }
  }

  // 미판정 항목의 판정 제안 1건 수집 — 기확보 정보(DART 재무 facts·프로파일·
  // 공시)를 재검색하지 않고 활용하고, 부족한 정보만 서버가 웹검색한다. 결과는
  // 누적기(acc)에 병합되고 화면 상태에도 반영된다. 사람이 확정(저장)한 항목은
  // 건드리지 않고, 그 외 항목은 재실행 시 새 제안으로 갱신한다 — 이미 제안된
  // 항목을 스킵하면 다시 눌러도 변화가 없어 버튼이 죽어 보였다(사용자 리포트,
  // 2026-09-16). 실패는 삼키지 않고 호출자(소집 흐름)로 전파한다.
  async function draftPrecheckInto(targetId: string, acc: Record<string, Record<string, PrecheckDraftItem>>): Promise<void> {
    if (!selected) return;
    const res = await api.post<ScreeningDraftResponse>(
      `/api/brownfield/${encodeURIComponent(selected.opportunity.id)}/targets/${encodeURIComponent(targetId)}/screening-draft`,
      {},
    );
    setPrecheckDraftNote((prev) => ({ ...prev, [targetId]: res.data.note ?? null }));
    const row = selected.targets.find((t) => t.id === targetId);
    const saved = row?.screening_json ? (JSON.parse(row.screening_json) as Record<string, string>) : {};
    const cur = { ...(acc[targetId] ?? {}) };
    for (const [itemId, d] of Object.entries(res.data.drafts ?? {})) {
      const already = saved[itemId];
      if (already && already !== "pending") continue; // 사람이 확정한 판정만 유지
      cur[itemId] = { verdict: d.verdict, rationale: d.rationale, source_url: d.source_url, kind: d.kind };
    }
    acc[targetId] = cur;
    setPrecheckDraft((prev) => ({ ...prev, [targetId]: cur }));
  }

  // ── 위원회 추천 검토 — 위원회 소집(CommitteePanel beforeConvene 훅)의 선행
  // 단계로 실행된다(사용자 결정, 2026-09-16: 사전 검토 제안 생성과 위원회 소집을
  // 하나의 흐름으로 통합 — 별도 버튼은 역할 중복). Short List 후보 전체의
  // 기확보 정보(재무·프로파일·공시)를 활용하고 부족한 정보만 검색해 판정 제안을
  // 만든 뒤, 그 제안을 포함한 심의 brief를 반환한다. 후보가 하나도 성공하지
  // 못하면 예외를 던져 소집을 막고 패널에 에러를 표시한다 — 부분 성공이면
  // 성공한 제안으로 소집을 진행한다.
  async function runCommitteePrecheck(): Promise<string | undefined> {
    if (!selected || recoBusy) return;
    setRecoBusy(true); setError(null);
    const failures: string[] = [];
    let lastError: Error | null = null;
    try {
      const acc: Record<string, Record<string, PrecheckDraftItem>> = { ...precheckDraft };
      for (let i = 0; i < shortlistedTargets.length; i++) {
        const t = shortlistedTargets[i];
        setRecoProgress(`${t.company_name} (${i + 1}/${shortlistedTargets.length})`);
        try {
          await draftPrecheckInto(t.id, acc);
        } catch (err) {
          failures.push(t.company_name);
          lastError = err instanceof Error ? err : new Error(String(err));
          setError(`사전 검토 제안 생성 실패 — ${t.company_name}: ${lastError.message}`);
        }
      }
      if (failures.length > 0 && failures.length === shortlistedTargets.length) {
        throw lastError ?? new Error("판정 제안 생성에 실패했습니다");
      }
      return buildEvalBriefMd(selected.targets, selected.checklist, acc);
    } finally {
      setRecoBusy(false);
      setRecoProgress(null);
    }
  }

  async function shortlist(targetId: string) {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/brownfield/${selected.opportunity.id}/targets/${targetId}/shortlist`, {});
      loadDetail(selected.opportunity.id);
      onSaved?.();
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
      onSaved?.();
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
  // 전치 테이블(항목 = 컬럼, 후보 = 행)의 Part 그룹 컬럼 수
  const checklistItems = selected?.checklist ?? [];
  const part1Count = checklistItems.filter((it) => KNOCKOUT_IDS.has(it.id)).length;
  const part2Count = checklistItems.length - part1Count;
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
  // 평가 기반 잠정 순위 — 제외를 뺀 전 후보(pending + shortlisted) 대상.
  // Short List로 승격해도 순위가 사라지지 않는다(사용자 리포트, 2026-09-16 —
  // 승격·제외 시 잠정 순위가 "—"로 사라지는 문제). 승격이 같은 점수 기준이므로
  // 순위 모집단도 같게 유지한다. Short List의 표시 순위(rank)는 별개(사람 조정).
  const evalRank = new Map(targets.filter((t) => t.status !== "excluded" && t.eval_summary?.combined != null)
    .slice()
    .sort((a, b) => (b.eval_summary?.combined ?? -1) - (a.eval_summary?.combined ?? -1))
    .map((t, i) => [t.id, i + 1]));
  const shortlistOrder = shortlistedTargets.map((t) => t.id);
  // Short List 후보 중 사전 검토(chk-target-screening)가 미완료인 후보 수 —
  // 위원회 최종 검토 전 판정 기록 권장 신호(사용자 결정, 2026-09-16: 체크리스트는
  // Short List 후보의 "문제 없는지" 최종 점검 도구).
  const precheckIncomplete = shortlistedTargets.filter((t) => {
    const s = t.screening_summary;
    return !s || s.anyKnockOutFail || s.assessed < s.total || s.mandatoryOpen.length > 0;
  }).length;

  return (
    <>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── 목표 시장 정의 (S6) — 보기(읽기 전용) / 수정(모달) 분리. mockup처럼
          탭 없이 항상 렌더링, 흐름 배너에서 스크롤로만 이동한다. ── */}
      {selected && (
        <div id={SECTION_IDS.universe} className="grid gap-3 items-stretch md:grid-cols-[2fr_3fr]" style={{ scrollMarginTop: "1rem" }}>
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
                        <td className="tabular-nums" title="재무·기술 평가 종합 점수(financial·technical 평균) 기준 잠정 순위 — 제외를 뺀 전 후보 대상으로 유지(승격해도 사라지지 않음). Short List rank(사람이 조정)와 별개">
                          {t.status === "excluded" ? (
                            <span className="text-[color:var(--muted-fg)]">—</span>
                          ) : es?.combined != null ? (
                            t.status === "shortlisted" ? (
                              <span className="text-[color:var(--muted-fg)]" title="승격 시점 평가 기준 잠정 순위(참고) — Short List 표시 순위는 사람이 조정한 rank입니다">
                                #{evalRank.get(t.id)} ({es.combined}점)
                              </span>
                            ) : (
                              <>#{evalRank.get(t.id)} <span className="text-[color:var(--muted-fg)]">({es.combined}점)</span></>
                            )
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
          {/* ── 사전 검토 — chk-target-screening t-01~t-09 전 항목. Short List에
              오른 후보를 대상으로 "문제 없는지" 최종 점검하는 체크리스트다
              (사용자 결정, 2026-09-16). 판정 기록도 이 섹션에서 인라인으로 한다 —
              상세 화면·Long List의 사전 검토 표면은 제거(사용자 결정, 2026-09-16).
              공식 판정이 아니며 승격/추진을 막지 않는다. 위원회가 이 판정을 근거로
              Short List를 최종 검토해 사람에게 게이트 결정을 제안한다. ── */}
          {shortlistedTargets.length > 0 && (
            <section aria-label="사전 검토 · 위원회 추천" className="market-section">
              <SectionToolbar
                title="사전 검토 · 위원회 추천 — chk-target-screening (t-01~t-09)"
                summary={
                  <span className="note">
                    — Short List 최종 점검 · 공식 판정 아님
                    <span className={`status-chip ml-2 ${precheckIncomplete === 0 ? "status-green" : "status-amber"}`}>
                      {precheckIncomplete === 0 ? "전 후보 검토 완료" : `미완료 ${precheckIncomplete}/${shortlistedTargets.length}`}
                    </span>
                  </span>
                }
              />
              {/* 통합 플로우(사용자 결정, 2026-09-16): 아래 "위원회 추천 검토 · 소집"
                  버튼 하나가 (1) 후보별로 기확보 정보(DART 재무 facts·AI 프로파일·
                  공시 — 재검색 안 함)를 활용하고 부족한 정보만 검색해 판정 제안을
                  만들고 (2) 그 제안을 심의 근거로 위원회를 소집한다. 사람은 표에서
                  제안을 검토·수정한 뒤 저장으로 확정하고, 게이트 결정(사람)으로
                  이어진다. */}
              {(() => {
                // 접힘 기본값: 사용자 선택 > (미완료 → 펼침 / 완료 → 접음)
                const precheckOpenEffective = precheckOpen ?? precheckIncomplete > 0;
                return (
                  <details
                    open={precheckOpenEffective}
                    onToggle={(e) => setPrecheckOpen((e.currentTarget as HTMLDetailsElement).open)}
                  >
                    <summary className="cursor-pointer text-[0.8rem] text-[color:var(--muted-fg)]">
                      판정표 열기/닫기 — 후보 {shortlistedTargets.length}건 × chk-target-screening {checklistItems.length}항목
                    </summary>
              {recoBusy && (
                <p className="text-[0.78rem] text-[color:var(--amber-fg)] mb-2" role="status">
                  근거 수집·판정 제안 생성 중 — {recoProgress ?? "준비 중"} (완료되면 이 표의 미판정 셀이 채워지고 위원회가 자동 소집됩니다. 수십 초 걸릴 수 있습니다)
                </p>
              )}
              <p className="mb-2 text-[0.75rem] text-[color:var(--muted-fg)]">
                이 표는 아래 위원회 패널의 <b>&quot;위원회 추천 검토 · 소집&quot;</b> 버튼으로 채웁니다 — 누르면 ① 후보별 판정 제안이 이 표의 미판정 셀에 채워지고(기확보 정보 활용 + 부족한 정보만 검색, 재실행 시 확정 판정을 유지한 채 미판정만 다시 제안) ② 그 제안을 근거로 위원회가 심의합니다. 셀을 검토·수정한 뒤 행별 <b>판정 저장</b>으로 확정하세요.
              </p>
              {/* 전치 테이블 — 평가 항목(t-01~09)이 컬럼 헤더, 후보가 행(사용자
                  제안, 2026-09-16). 후보 간 비교와 위원회 검토에 맞는 형태다.
                  셀은 판정 select 하나로 압축하고, 근거(제안 사유·출처·기확보
                  구분)는 툴팁과 표식으로 보여준다. */}
              <div className="overflow-x-auto">
                <table className="data-table" aria-label="사전 검토 · 위원회 추천">
                  <caption className="sr-only">Short List 후보 × chk-target-screening 항목 판정표</caption>
                  <thead>
                    <tr>
                      <th rowSpan={2} scope="col">후보</th>
                      <th colSpan={part1Count} scope="colgroup" className="text-center">Part 1 — 필수 (knock-out)</th>
                      <th colSpan={part2Count} scope="colgroup" className="text-center">Part 2 — 권장 평가</th>
                      <th rowSpan={2} scope="col">확정</th>
                    </tr>
                    <tr>
                      {checklistItems.map((it) => (
                        <th key={it.id} scope="col" className="whitespace-nowrap" title={`${it.text}${it.mandatory ? " (필수)" : ""}`}>
                          <code className="dd-item-id mr-1">{it.id}</code>{it.text.split(" — ")[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shortlistedTargets.map((t) => {
                      const states = t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>) : {};
                      const concern = ["t-01", "t-02"].some((id) => normalizeVerdict(states[id]) === "unfulfilled");
                      const sm = t.screening_summary;
                      const total = sm?.total ?? checklistItems.length;
                      const draft = precheckDraft[t.id] ?? {};
                      const dirtyCount = Object.keys(draft).length;
                      // 추천안 — 확정 판정 + 미확정 제안을 합쳐 결정론 규칙으로 도출
                      // (Part 1 knock-out 기준). 위원회 제안이며 확정은 사람이 저장으로 한다.
                      const mergedVerdicts: Record<string, string> = { ...states };
                      for (const [itemId, d] of Object.entries(draft)) {
                        if (d.verdict) mergedVerdicts[itemId] = d.verdict;
                      }
                      const reco = precheckRecommendation(mergedVerdicts);
                      const hasReco = [...KNOCKOUT_IDS].some((id) => mergedVerdicts[id] && mergedVerdicts[id] !== "pending");
                      // 진행 칩은 확정+미확정 제안을 합쳐 센다 — 제안으로 채워져도
                      // 0/9로 보이는 문제를 막는다(사용자 리포트, 2026-09-16).
                      const mergedAssessed = checklistItems.filter((it) => {
                        const nv = normalizeVerdict(mergedVerdicts[it.id]);
                        return nv !== "pending";
                      }).length;
                      const mergedClass = sm?.anyKnockOutFail
                        ? "status-red"
                        : mergedAssessed === 0
                          ? "status-not-started"
                          : mergedAssessed < total || (sm?.mandatoryOpen.length ?? 0) > 0
                            ? "status-amber"
                            : "status-green";
                      const note = precheckDraftNote[t.id];
                      return (
                        <tr key={t.id}>
                          <td className="cell-primary">
                            <div className="flex flex-col gap-1">
                              <strong className="text-[0.85rem]">{t.company_name}{t.rank ? ` · rank ${t.rank}` : ""}</strong>
                              <span className="flex flex-wrap items-center gap-1">
                                {concern && <span className="status-chip status-red" title="t-01 또는 t-02 미충족">인수 가능성 우려</span>}
                                {hasReco && (
                                  <span className={`status-chip ${reco.cls}`} title={`Part 1(knock-out t-01~t-05) 기준 위원회 추천안 — 확정은 사람이 저장으로 합니다${dirtyCount > 0 ? " · 미확정 제안 포함" : ""}`}>
                                    추천안 · {reco.label}
                                  </span>
                                )}
                                <span
                                  className={`status-chip ${mergedClass}`}
                                  title={`t-01~09 판정 ${mergedAssessed}/${total}${dirtyCount > 0 ? ` (미확정 제안 ${dirtyCount}건 포함)` : ""}${sm?.mandatoryOpen.length ? ` · 미판정 필수: ${sm.mandatoryOpen.join(", ")}` : ""}${sm?.anyKnockOutFail ? " · 필수 미충족 있음" : ""}`}
                                >
                                  판정 {mergedAssessed}/{total}
                                </span>
                              </span>
                            </div>
                          </td>
                          {checklistItems.map((it) => {
                            const v = draft[it.id]?.verdict ?? states[it.id] ?? "pending";
                            const meta = draft[it.id];
                            // 근거(제안 사유·출처)는 셀 안 링크 대신 툴팁으로 — 링크가
                            // 셀 아래 줄을 만들어 행 높이가 어긋나는 문제를 막는다
                            // (사용자 UI 리포트, 2026-09-16). 전체 근거는 후보 상세
                            // '사전 검토 근거' 탭에서 본다.
                            const tip = [
                              it.text,
                              meta?.rationale ? `제안 사유: ${meta.rationale}` : null,
                              meta?.source_url ? `출처: ${meta.source_url}` : null,
                            ].filter(Boolean).join("\n");
                            return (
                              <td key={it.id}>
                                <select
                                  aria-label={`${t.company_name} ${it.id} 판정`}
                                  className="sizing-new-input sizing-new-input-sm w-full"
                                  style={{ minWidth: "5.5rem" }}
                                  title={tip}
                                  value={v}
                                  onChange={(e) => setPrecheckDraft((prev) => ({ ...prev, [t.id]: { ...(prev[t.id] ?? {}), [it.id]: { verdict: e.target.value } } }))}
                                >
                                  <option value="pending">미판정</option>
                                  {SCREENING_VERDICT_KEYS.map((sv) => (
                                    <option key={sv} value={sv}>{SCREENING_VERDICT_KO[sv]}</option>
                                  ))}
                                </select>
                              </td>
                            );
                          })}
                          <td>
                            <div className="flex flex-col items-start gap-1">
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                disabled={precheckBusy === t.id || recoBusy || dirtyCount === 0}
                                title="화면에서 고른 판정을 저장합니다 — 수집 근거도 함께 저장되어 후보 상세 '사전 검토 근거' 탭에서 참고할 수 있습니다"
                                onClick={() => savePrecheck(t.id)}
                              >
                                판정 저장{dirtyCount > 0 ? ` (${dirtyCount}건)` : ""}
                              </button>
                              {note && (
                                <span className="text-[0.65rem] text-[color:var(--muted-fg)] max-w-[10rem] truncate" title={note}>{note}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 위원회 심의 — "위원회 추천 검토 · 소집" 버튼 하나로 (1) 위 표의
                  판정 제안 생성(기확보 정보 활용 + 부족한 정보만 검색)과 (2) 그
                  제안을 근거로 한 위원회 소집이 함께 실행된다(ADR-0097 · 사용자
                  결정 2026-09-16 — 제안 생성과 소집의 역할 중복을 해소). 소집된
                  위원회의 심의 결과는 제안(PROPOSED)이며, 확정은 사람이 한다.
                  재무·기술 평가(랭킹용)와 역할은 분리된다. */}
              <div className="flex flex-wrap items-center gap-2 mt-2 mb-0">
                {precheckIncomplete === 0 ? (
                  <span className="status-chip status-green">사전 검토 완료</span>
                ) : (
                  <span className="status-chip status-amber" title="판정이 덜 기록되었거나 필수 미충족이 있는 후보가 있습니다">
                    사전 검토 미완료 {precheckIncomplete}/{shortlistedTargets.length}
                  </span>
                )}
                <span className="text-[0.78rem] text-[color:var(--muted-fg)]">
                  버튼을 누르면 ① 위 표의 미판정 셀에 판정 제안이 채워지고(기확보 정보 활용 + 부족한 정보만 검색) ② 그 제안을 근거로 위원회가 심의해 ③ 아래 Target Screening 게이트 결정(사람)에 제안합니다. 제안 확정은 표의 판정 저장으로 합니다.
                </span>
              </div>
                  </details>
                );
              })()}
              <CommitteePanel
                opportunityId={selected.opportunity.id}
                committeeKey="target-longlist-shortlist-committee"
                committeeLabel="S6/S7 Short List 최종 검토 위원회 (롱리스트→숏리스트)"
                gates={["target_screening"]}
                briefMd={buildEvalBriefMd(selected.targets, selected.checklist, precheckDraft)}
                beforeConvene={runCommitteePrecheck}
                conveneLabel="위원회 추천 검토 · 소집"
              />
            </section>
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
    </>
  );
}
