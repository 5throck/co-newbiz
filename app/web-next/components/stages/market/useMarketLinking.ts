"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useState, useCallback } from "react";
import { api } from "../../../lib/api.ts";
import type { useMarketData } from "./useMarketData.ts";
import { useTranslations } from "next-intl";

export function useMarketLinking(prev: ReturnType<typeof useMarketData>) {const t = useTranslations("stages.s1.useMarketLinking"); const tc = useTranslations("common");
  const { setError, newCode, setNewName, setNewCode, setKsicResults, setShowNewForm, refreshOverview, setLinkNotice, urlSync, router, setLocalIndustry, setDetail } = prev;


  // ── 가치사슬 연계 후보 모달 (S1 분석·재분석 범위 선택) ──
  // 분석(또는 재분석) 대상 산업과 연관된 산업 후보를 보여주고, 사용자가
  // 선택한 산업을 함께 분석한다. 마스터에 없는 산업은 분석 생성 시
  // 자동 등록된다(서버 name 기반 dedup) — 선택 자체가 승인 행위다(경계 #2).
  interface RelatedCandidate {
    name_ko: string; industry_id: string | null; relation: string; note: string | null; source: "link" | "analysis" | "proxy";
    linkSource?: string;
    linkStatus?: string;
    // ADR-0129 — 이미 등록된 활성 proxy_link 행에서 온 후보인지. locked 후보는
    // 재분석 시 자동 반영되므로 해제할 수 없고(선택 해제 불가), 기본 선택됨.
    locked: boolean;
  }
  const [linkModal, setLinkModal] = useState<{
    open: boolean;
    primaryName: string;          // 이번에 분석(또는 재분석)할 대상
    rerunAnalysisId: string | null; // 재분석 모드일 때 대상 분석 id
    candidates: RelatedCandidate[];
    industryKnown: boolean;       // 대상이 산업 마스터에 등록되어 있는지
    selected: Set<string>;
    loading: boolean;
    running: boolean;
    // 방법론 패널 P0 — 대체/보완 관계는 사슬 후보에서 분리해 "대체 위협"으로 표출한다.
    substitutes: Array<{ name_ko: string; relation: string; note: string | null }>;
  }>({ open: false, primaryName: "", rerunAnalysisId: null, candidates: [], industryKnown: false, selected: new Set(), loading: false, running: false, substitutes: [] });

  // ADR-0129 — 서버가 붙여준 linkSource/linkStatus로 "이미 등록된 활성 연계"
  // 여부를 판정하고, locked 후보는 기본 선택 상태로 미리 채운다.
  function markLocked(candidates: RelatedCandidate[]): RelatedCandidate[] {
    return candidates.map((c) => ({ ...c, locked: c.linkSource !== undefined && c.linkStatus === "active" }));
  }
  function preselectLocked(candidates: RelatedCandidate[]): Set<string> {
    return new Set(candidates.filter((c) => c.locked).map((c) => c.name_ko));
  }

  async function openLinkModal(primaryName: string, rerunAnalysisId: string | null = null) {
    setLinkModal({ open: true, primaryName, rerunAnalysisId, candidates: [], industryKnown: false, selected: new Set(), loading: true, running: false, substitutes: [] });
    try {
      const r = await api.get<{ industry: { id: string } | null; candidates: RelatedCandidate[]; substitutes?: Array<{ name_ko: string; relation: string; note: string | null }> }>(
        `/api/market-overview/related-candidates?name=${encodeURIComponent(primaryName)}`,
      );
      if (r.data.candidates.length > 0 || (r.data.substitutes?.length ?? 0) > 0) {
        const candidates = markLocked(r.data.candidates);
        setLinkModal((prev) => ({ ...prev, loading: false, industryKnown: r.data.industry !== null, candidates, selected: preselectLocked(candidates), substitutes: r.data.substitutes ?? [] }));
        return;
      }
      // 저장된 후보(연계 링크·과거 분석)가 없으면 1차 가치사슬 연계 산업 분석을
      // 자동 실행해 관련 산업과 연관성을 먼저 보여준다 (사용자 결정 사항).
      setLinkModal((prev) => ({ ...prev, loading: true, industryKnown: r.data.industry !== null }));
      const p = await api.post<{ industry: { id: string } | null; candidates: RelatedCandidate[]; substitutes?: Array<{ name_ko: string; relation: string; note: string | null }> }>(
        "/api/market-overview/related-candidates",
        { name: primaryName },
      );
      const candidates = markLocked(p.data.candidates);
      setLinkModal((prev) => ({ ...prev, loading: false, industryKnown: p.data.industry !== null, candidates, selected: preselectLocked(candidates), substitutes: p.data.substitutes ?? [] }));
    } catch {
      setLinkModal((prev) => ({ ...prev, loading: false }));
    }
  }

  // 1차 가치사슬 연계 산업 분석 재실행 — 모달 안에서 수동으로 다시 돌릴 수 있다.
  async function rerunProxyAnalysis() {
    if (linkModal.loading || linkModal.running) return;
    setLinkModal((prev) => ({ ...prev, loading: true }));
    try {
      const p = await api.post<{ industry: { id: string } | null; candidates: RelatedCandidate[]; substitutes?: Array<{ name_ko: string; relation: string; note: string | null }> }>(
        "/api/market-overview/related-candidates",
        { name: linkModal.primaryName },
      );
      const candidates = markLocked(p.data.candidates);
      setLinkModal((prev) => ({
        ...prev,
        loading: false,
        industryKnown: p.data.industry !== null,
        candidates,
        substitutes: p.data.substitutes ?? [],
        // 재실행으로 새로 온 locked 후보도 선택 목록에 포함시키되, 사용자가
        // 이미 직접 고른(비-locked) 선택은 유지한다.
        selected: new Set([...prev.selected, ...preselectLocked(candidates)]),
      }));
    } catch {
      setLinkModal((prev) => ({ ...prev, loading: false }));
    }
  }

  // 레드팀 가드레일 — 대기 큐 상한: 무제한 큐는 비용·시간 폭탄이 된다.
  const MAX_QUEUE_SELECTIONS = 5;
  function toggleCandidate(name: string, locked: boolean) {
    if (locked) return; // 등록된 연계 후보는 재분석에 자동 반영되어 해제할 수 없다.
    setLinkModal((prev) => {
      const selected = new Set(prev.selected);
      if (selected.has(name)) selected.delete(name);
      else {
        if (selected.size >= MAX_QUEUE_SELECTIONS) return prev;
        selected.add(name);
      }
      return { ...prev, selected };
    });
  }

  async function runWithSelections() {
    if (linkModal.running) return;
    setLinkModal((prev) => ({ ...prev, running: true }));
    setError(null);
    try {
      // 대상 분석: 재분석 모드면 rerun, 신규 모드면 생성(마스터 자동 등록 포함)
      if (linkModal.rerunAnalysisId) {
        await api.post(`/api/market-overview/analyses/${encodeURIComponent(linkModal.rerunAnalysisId)}/rerun`);
      } else {
        await api.post("/api/market-overview/analyses", { name_ko: linkModal.primaryName, ksic_code: newCode.trim() || undefined });
        setNewName(""); setNewCode(""); setKsicResults(null); setShowNewForm(false);
      }
      // 연계 산업(재분석 모드만) — after_analysis_id 앵커로 '연계 대기' 등록.
      // 서버가 대상 분석 완료 후 한 건씩 자동 시작한다(직렬 큐 — 설계 2026-09-13).
      // 신규 모드는 첫 분석 = 대상 산업만: 모달이 애초에 선택 UI를 노출하지 않는다.
      // locked(이미 등록된 proxy_link) 후보는 대상 파이프라인이 DB에서 직접
      // 재도출하므로 별도 분석을 스폰하지 않는다 — 선택 표시는 정보성일 뿐이다.
      const lockedNames = new Set(linkModal.candidates.filter((c) => c.locked).map((c) => c.name_ko));
      const relationByName = new Map(linkModal.candidates.map((c) => [c.name_ko, c.relation]));
      let extraCount = 0;
      if (linkModal.rerunAnalysisId) {
        for (const name of linkModal.selected) {
          if (name === linkModal.primaryName || lockedNames.has(name)) continue;
          await api.post("/api/market-overview/analyses", { name_ko: name, after_analysis_id: linkModal.rerunAnalysisId, linked_relation: relationByName.get(name) });
          extraCount++;
        }
      }
      await refreshOverview();
      setLinkModal({ open: false, primaryName: "", rerunAnalysisId: null, candidates: [], industryKnown: false, selected: new Set(), loading: false, running: false, substitutes: [] });
      if (extraCount > 0) setLinkNotice(t("p1LinkedIndustryIesQueued", { p1: extraCount, p2: linkModal.primaryName }));
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("analysisStartFailed"));
      setLinkModal((prev) => ({ ...prev, running: false }));
    }
  }

  const backToList = useCallback(() => {
    if (urlSync) router.replace("/market");
    else setLocalIndustry(null);
    setDetail(null);
  }, [urlSync, router]);

  // 재분석: 실패 재시작 또는 분석일 경과에 따른 데이터 갱신. 새 버전으로 쌓임.
  const STALE_DAYS = 90;
  const relDate = (d: string | null) => {
    if (!d) return null;
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    if (days <= 0) return t("today");
    if (days < 30) return t("p1DAgo", { p1: days });
    if (days < 365) return t("p1MoAgo", { p1: Math.floor(days / 30) });
    return t("p1YrAgo", { p1: Math.floor(days / 365) });
  };
  async function rerunAnalysis(analysisId: string, industryName: string) {
    // 재분석도 연관 산업 선택 모달을 거친다 — 같은 분석 행을 재실행하며
    // 선택된 연관 산업은 새로(또는 이어서) 분석을 시작한다.
    await openLinkModal(industryName, analysisId);
  }
  return { backToList, STALE_DAYS, openLinkModal, relDate, rerunAnalysis, linkModal, setLinkModal, toggleCandidate, rerunProxyAnalysis, runWithSelections };
}
