"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition).
// Group/flatten/split logic lives in grouping.ts (pure) — this hook only wires
// it into memoized state. Deal-context split (2026-10-16): dealLinkedIds
// carves the list into "linked to this deal" (first) and "다른 검토의 산업
// 분석" (second, visually secondary); null = not in a deal context, no split.
import { api } from "../../../lib/api.ts";
import { useMemo, useState } from "react";
import type { useMarketData } from "./useMarketData.ts";
import type { useMarketLinking } from "./useMarketLinking.ts";
import type { useDealIndustryLink } from "./useDealIndustryLink.ts";
import type { IndustryRow } from "./types.ts";
import { buildIndustryGroups, filterPinned, flattenGroups, splitGroups } from "./grouping.ts";
import { useTranslations } from "next-intl";

export function useMarketList(prev: ReturnType<typeof useMarketData> & ReturnType<typeof useMarketLinking> & ReturnType<typeof useDealIndustryLink>) {const t = useTranslations("stages.s1.useMarketList");
  const { confirm, setError, selectedIndustry, refreshOverview, editing, savingEdit, setSavingEdit, setEditing, query, overview, statusFilter, pinnedOnly, backToList, STALE_DAYS, linkedIds } = prev;


  // 산업 삭제 — market-sizing 분석(버전 행 포함)과 함께 삭제한다.
  function deleteIndustry(ind: IndustryRow) {
    confirm(
      t("deleteIndustryP1", { p1: ind.name_ko }),
      async () => {
        setError(null);
        try {
          await api.delete(`/api/market-overview/industry/${encodeURIComponent(ind.id)}`);
          if (selectedIndustry === ind.id) backToList();
          await refreshOverview();
        } catch (err) {
          setError(err instanceof Error ? err.message : t("failedToDeleteTheIndustry"));
        }
      },
      { body: t("thisIndustrySMarketAnalysis") },
    );
  }

  // 산업 정보 수정(이름·KSIC 코드) — 목록에서 인라인으로 편집한다.
  async function saveEdit() {
    if (!editing || savingEdit) return;
    if (!editing.name.trim()) { setError(t("theIndustryNameIsRequired")); return; }
    setSavingEdit(true);
    setError(null);
    try {
      await api.patch(`/api/market-overview/industry/${encodeURIComponent(editing.id)}`, {
        name_ko: editing.name.trim(),
        ksic_code: editing.code.trim() || null,
      });
      setEditing(null);
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToUpdateTheIndustry"));
    } finally {
      setSavingEdit(false);
    }
  }

  // 목록 파생: 검색 + 상태 필터 + 우선순위 정렬(분석 중 → 업데이트 권장 → 최근 분석 → 대기)
  const buckets = useMemo(() => {
    const of = (ind: IndustryRow): IndustryRow["analysis"] & { bucket: "in_progress" | "stale" | "completed" | "pending" | "failed" } | null => {
      const a = ind.analysis;
      if (!a) return null;
      const d = (a.completed_at ?? a.created_at).slice(0, 10);
      const stale = a.status === "completed" && d && (Date.now() - new Date(d).getTime()) / 86400000 > STALE_DAYS;
      return { ...a, bucket: a.status === "in_progress" ? "in_progress" : a.status === "pending" ? "pending" : a.status === "failed" ? "failed" : stale ? "stale" : "completed" };
    };
    return { of };
  }, []);
  const visibleIndustries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (overview?.industries ?? [])
      .filter((ind) => {
        if (q && !(ind.name_ko.toLowerCase().includes(q) || (ind.name_en ?? "").toLowerCase().includes(q) || (ind.ksic_code ?? "").toLowerCase().includes(q))) return false;
        if (statusFilter === "all") return true;
        const b = buckets.of(ind)?.bucket ?? "pending";
        return b === statusFilter;
      });
    const rank = { failed: 0, in_progress: 1, stale: 2, completed: 3, pending: 4 } as const;
    return [...rows].sort((x, y) => {
      const bx = buckets.of(x)?.bucket ?? "pending";
      const by = buckets.of(y)?.bucket ?? "pending";
      if (rank[bx] !== rank[by]) return rank[bx] - rank[by];
      const dx = x.analysis ? (x.analysis.completed_at ?? x.analysis.created_at) : "";
      const dy = y.analysis ? (y.analysis.completed_at ?? y.analysis.created_at) : "";
      return dy.localeCompare(dx);
    });
  }, [overview, query, statusFilter, buckets]);

  // 관계별 그룹핑 — 본 산업(anchor) 아래에 전전방/전방/후방/후후방으로 딸린
  // 산업을 묶어 보여준다. 두 가지 등록 경로 모두를 근거로 쓴다:
  //   (1) 연계 큐 등록 시 기록되는 analysis.after_analysis_id/linked_relation
  //       (ADR-0130 — "연계 산업 이어서 분석"으로 등록된 경우)
  //   (2) "가치사슬 연계" 화면에서 사람이 직접 등록한 proxy_link.relation
  //       (ADR-0129 — 이미 각자 분석이 끝난 산업을 사후에 연결한 경우)
  // relation은 항상 "전방/전전방이면 from이 앵커, 후방/후후방이면 to가 앵커"
  // 규약으로 저장된다(chain-links/route.ts). 순수 로직은 grouping.ts.
  const industryGroups = useMemo(
    () => buildIndustryGroups(visibleIndustries, overview?.industryLinks),
    [visibleIndustries, overview?.industryLinks],
  );

  // 스케폴드(접기/펼치기) — 연계 산업이 있는 본 산업은 기본 접힘 상태로
  // 시작해, 목록이 길어져도 한눈에 훑어볼 수 있게 한다.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (rootId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId); else next.add(rootId);
      return next;
    });
  };
  const displayedGroups = useMemo(() => {
    if (!pinnedOnly) return industryGroups;
    // 고정한 본 산업은 그룹째로 남기고, 고정한 연계 산업은 앵커가 미고정이면
    // 개별 최상위 행으로 승격한다 — 핀 버튼 title의 "'핵심만 보기'에서 최상위로
    // 표시됩니다" 약속을 연계 산업에도 지키기 위함(단일 부모 가정, 중복 승격 방지).
    return filterPinned(industryGroups);
  }, [industryGroups, pinnedOnly]);
  // 딜 컨텍스트 분할 — 앵커 기준으로 그룹이 통째로 따라간다(grouping.splitGroups).
  const { linkedGroups, otherGroups } = useMemo(() => {
    const s = splitGroups(displayedGroups, linkedIds ?? null);
    return { linkedGroups: s.linked, otherGroups: s.other };
  }, [displayedGroups, linkedIds]);
  const flatRows = useMemo(() => flattenGroups(displayedGroups, expandedGroups, toggleGroup), [displayedGroups, expandedGroups]);
  const linkedFlatRows = useMemo(() => flattenGroups(linkedGroups, expandedGroups, toggleGroup), [linkedGroups, expandedGroups]);
  const otherFlatRows = useMemo(() => flattenGroups(otherGroups, expandedGroups, toggleGroup), [otherGroups, expandedGroups]);

  const statusCounts = useMemo(() => {
    const counts = { all: 0, in_progress: 0, completed: 0, stale: 0, pending: 0, failed: 0 };
    for (const ind of overview?.industries ?? []) {
      counts.all++;
      counts[buckets.of(ind)?.bucket ?? "pending"]++;
    }
    return counts;
  }, [overview, buckets]);
  return { statusCounts, visibleIndustries, flatRows, linkedFlatRows, otherFlatRows, saveEdit, deleteIndustry };
}

export type MarketAnalysisStageState = ReturnType<typeof useMarketData> & ReturnType<typeof useMarketLinking> & ReturnType<typeof useDealIndustryLink> & ReturnType<typeof useMarketList>;
