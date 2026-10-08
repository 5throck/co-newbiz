"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../../lib/api.ts";
import { useConfirm } from "../../crud.tsx";
import type { MarketOverview, IndustryDetail, KsicEntryView, LlmStatus, IndustryRow, ChainGraphNode, ChainGraphEdge } from "./types.ts";

export function useMarketData({ industryId: industryIdProp, embedded, startNew }: { industryId?: string; embedded?: boolean; startNew?: boolean }) {

  const { me } = useAuth();
  const canCurate = canWriteBusiness(me?.role);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [detail, setDetail] = useState<IndustryDetail | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSync = !embedded;
  const [localIndustry, setLocalIndustry] = useState<string | null>(industryIdProp ?? null);
  const selectedIndustry = urlSync ? searchParams.get("industry") : localIndustry;
  const [error, setError] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(!!startNew);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [ksicResults, setKsicResults] = useState<KsicEntryView[] | null>(null);
  const [ksicSearching, setKsicSearching] = useState(false);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "in_progress" | "completed" | "stale" | "pending" | "failed">("all");
  // 핵심 산업만 보기 — 연계 자동 등록(전방/전전방/후방/후후방)으로 목록이
  // 길어져도 사용자가 직접 고정(pin)한 산업만 최상위로 보이게 한다.
  // 본 산업을 고정하면 연계 그룹이 하위에 그대로 딸려 온다. 연계 산업도
  // 개별 고정할 수 있고(2026-09-14 사용자 리포트 — 유압식 브레이커),
  // 앵커가 고정되지 않았으면 '핵심만 보기'에서 개별 최상위 행으로
  // 끌어올린다. 기본값은 false(전체 보기) — 아직 아무것도 고정하지
  // 않은 상태에서 목록이 비어 보이는 걸 막는다.
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [pinBusyId, setPinBusyId] = useState<string | null>(null);
  async function togglePin(ind: IndustryRow) {
    setPinBusyId(ind.id);
    try {
      await api.patch(`/api/market-overview/industry/${encodeURIComponent(ind.id)}`, { pinned: !ind.pinned });
      await refreshOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "고정 상태 변경 실패");
    } finally {
      setPinBusyId(null);
    }
  }
  const [editing, setEditing] = useState<{ id: string; name: string; code: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [savingEdit, setSavingEdit] = useState(false);
  const [chainGraph, setChainGraph] = useState<{ nodes: ChainGraphNode[]; edges: ChainGraphEdge[] } | null>(null);
  const [chainGraphOpen, setChainGraphOpen] = useState(false);

  useEffect(() => {
    api.get<{ nodes: ChainGraphNode[]; edges: ChainGraphEdge[] }>("/api/market-overview/value-chain-graph")
      .then((r) => setChainGraph(r.data))
      .catch(() => setChainGraph({ nodes: [], edges: [] }));
  }, []);

  const refreshOverview = useCallback(() => {
    return api.get<MarketOverview>("/api/market-overview")
      .then((r) => { setOverview(r.data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  useEffect(() => {
    void refreshOverview();
    api.get<LlmStatus>("/api/llm-status").then((r) => setLlmStatus(r.data)).catch(() => setLlmStatus({ configured: false, provider: null, model: null }));
  }, [refreshOverview]);

  // 분석 중인 산업이 있으면 3초 간격으로 상태 폴링 → 완료 시 목록이 자동 갱신
  const hasInProgress = overview?.industries.some((i) => i.analysis?.status === "in_progress" || i.analysis?.status === "pending" || !!i.analysis?.rerun_in_progress) ?? false;
  useEffect(() => {
    if (!hasInProgress) return;
    const t = setInterval(() => { void refreshOverview(); }, 3000);
    return () => clearInterval(t);
  }, [hasInProgress, refreshOverview]);

  // 상세 진입은 URL(?industry=)기반 — 상단 바의 뒤로 가기가 동작하도록 한다.
  const loadDetail = useCallback((industryId: string) => {
    if (urlSync) router.replace(`/market?industry=${encodeURIComponent(industryId)}`);
    else setLocalIndustry(industryId);
  }, [urlSync, router]);

  useEffect(() => {
    if (!selectedIndustry) { setDetail(null); return; }
    if (detail?.industry.id === selectedIndustry) return;
    setDetail(null);
    api.get<IndustryDetail>(`/api/market-overview/industry/${encodeURIComponent(selectedIndustry)}`)
      .then((r) => setDetail(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "상세 불러오기 실패"));
  }, [selectedIndustry]);  // eslint-disable-line react-hooks/exhaustive-deps

  // KSIC 코드 검색 — DART 검색과 동일한 표준 패턴(이름으로 검색 → 결과 선택 시 코드 채움):
  // 명시적 검색 버튼(lucide Search 아이콘 — 아이콘 어휘표 검색/조회), 검색어는 KSIC
  // 입력값을 우선하고 비어 있으면 산업명으로 조회.
  // 결과는 sizing-note-list 목록으로 제시하고 선택은 클릭(aria-pressed + ✔ 표시).
  async function searchKsicCodes() {
    const q = newCode.trim() || newName.trim();
    if (!q || ksicSearching) return;
    setKsicSearching(true);
    setError(null);
    try {
      const res = await api.get<{ entries: KsicEntryView[] }>(`/api/market-overview/ksic?q=${encodeURIComponent(q)}`);
      setKsicResults(res.data.entries);
      if (res.data.entries.length === 0) setError("KSIC 검색 결과가 없습니다 — 코드를 직접 입력하세요.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "KSIC 검색 실패");
    } finally {
      setKsicSearching(false);
    }
  }
  return { setError, newCode, setNewName, setNewCode, setKsicResults, setShowNewForm, refreshOverview, setLinkNotice, urlSync, router, setLocalIndustry, setDetail, confirm, selectedIndustry, editing, savingEdit, setSavingEdit, setEditing, query, overview, statusFilter, pinnedOnly, confirmDialog, linkNotice, chainGraph, setChainGraphOpen, error, chainGraphOpen, detail, setQuery, setStatusFilter, setPinnedOnly, canCurate, showNewForm, newName, ksicSearching, searchKsicCodes, ksicResults, llmStatus, hasInProgress, pinBusyId, togglePin, loadDetail };
}
