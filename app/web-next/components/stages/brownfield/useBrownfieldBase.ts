"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { useState, useCallback, useEffect } from "react";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { api } from "../../../lib/api.ts";
import type { OppDetail, PrecheckDraftItem, Suggestion, WebSuggestion, UniRecoResponse, EvalItem, EvalCategoryScore, FinancialsResp } from "./types.ts";

export function useBrownfieldBase({ opportunityId, onSaved }: { opportunityId: string; onSaved?: () => void }) {

  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);
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
  // DART 재무 참고 패널 — company_id(Long List 등록 시점부터 존재) 기준.
  const [financials, setFinancials] = useState<Record<string, FinancialsResp | null>>({});

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
  return { savingUniverse, selected, universeDraft, setSavingUniverse, setError, loadDetail, setEditingUniverse, setUniReco, setUniRecoApplied, setUniverseDraft, setGapHint, gapHint, opportunityId, setSelected, webBusy, setWebBusy, setWebProposals, setWebNote, setWebSource, uniBusy, setUniBusy, setEvalItems, setEvalScores, setFinancials, newTarget, busy, setBusy, setNewTarget, onSaved, precheckBusy, precheckDraft, setPrecheckBusy, setPrecheckDraft, setPrecheckDraftNote, recoBusy, setRecoBusy, setRecoProgress, error, canAct, discoveryPanel, setDiscoveryPanel, proposals, webProposals, setDartResults, dartBusy, searchDartCompanies, dartError, dartResults, acceptProposal, webModalFocus, webNote, webSource, editingUniverse, uniReco, uniRecoApplied, precheckOpen, setPrecheckOpen, recoProgress, precheckDraftNote };
}
