"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { api } from "../../../lib/api.ts";
import { useMemo, useState } from "react";
import type { useMarketData } from "./useMarketData.ts";
import type { useMarketLinking } from "./useMarketLinking.ts";
import type { IndustryRow } from "./types.ts";

export function useMarketList(prev: ReturnType<typeof useMarketData> & ReturnType<typeof useMarketLinking>) {
  const { confirm, setError, selectedIndustry, refreshOverview, editing, savingEdit, setSavingEdit, setEditing, query, overview, statusFilter, pinnedOnly, backToList, STALE_DAYS } = prev;


  // 산업 삭제 — market-sizing 분석(버전 행 포함)과 함께 삭제한다.
  function deleteIndustry(ind: IndustryRow) {
    confirm(
      `산업 "${ind.name_ko}" 삭제`,
      async () => {
        setError(null);
        try {
          await api.delete(`/api/market-overview/industry/${encodeURIComponent(ind.id)}`);
          if (selectedIndustry === ind.id) backToList();
          await refreshOverview();
        } catch (err) {
          setError(err instanceof Error ? err.message : "산업 삭제 실패");
        }
      },
      { body: "이 산업의 시장분석 기록(버전 전체)과 참조 중인 가치사슬 연계·프로젝트 산업 바인딩·분석 산출물도 함께 삭제되며 되돌릴 수 없습니다. 승격된 투자 안건은 이력이 유지됩니다." },
    );
  }

  // 산업 정보 수정(이름·KSIC 코드) — 목록에서 인라인으로 편집한다.
  async function saveEdit() {
    if (!editing || savingEdit) return;
    if (!editing.name.trim()) { setError("산업명은 필수입니다."); return; }
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
      setError(err instanceof Error ? err.message : "산업 정보 수정 실패");
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
  // 산업을 묶어 보여준다. 두 가지 서로 다른 등록 경로 모두를 근거로 쓴다:
  //   (1) 연계 큐 등록 시 기록되는 analysis.after_analysis_id/linked_relation
  //       (ADR-0130 — "연계 산업 이어서 분석"으로 등록된 경우)
  //   (2) "가치사슬 연계" 화면에서 사람이 직접 등록한 proxy_link.relation
  //       (ADR-0129 — 이미 각자 분석이 끝난 산업을 사후에 연결한 경우.
  //       2026-09-14 사용자 리포트 — 연료전지↔수소 충전소 구축 서비스업을
  //       이 경로로 연결했는데 (1)만 보던 그룹핑에 반영되지 않았음)
  // relation은 항상 "전방/전전방이면 from이 앵커, 후방/후후방이면 to가 앵커"
  // 규약으로 저장된다(chain-links/route.ts). 새 스키마 없이 렌더링만 바꾼다.
  const RELATION_ORDER: Record<string, number> = { "전전방": 0, "전방": 1, "후방": 2, "후후방": 3 };
  const industryGroups = useMemo(() => {
    const byAnalysisId = new Map<string, IndustryRow>();
    const byIndustryId = new Map<string, IndustryRow>();
    for (const ind of visibleIndustries) {
      byIndustryId.set(ind.id, ind);
      if (ind.analysis) byAnalysisId.set(ind.analysis.id, ind);
    }
    const childIds = new Set<string>();
    const childrenByRootId = new Map<string, Array<{ ind: IndustryRow; relation: string }>>();
    const addChild = (rootId: string, childInd: IndustryRow, relation: string) => {
      if (rootId === childInd.id) return;
      childIds.add(childInd.id);
      const list = childrenByRootId.get(rootId) ?? [];
      if (!list.some((c) => c.ind.id === childInd.id)) list.push({ ind: childInd, relation });
      childrenByRootId.set(rootId, list);
    };
    // (1) 연계 큐 경로
    for (const ind of visibleIndustries) {
      const rel = ind.analysis?.linked_relation;
      const afterId = ind.analysis?.after_analysis_id;
      if (!rel || !afterId) continue;
      const root = byAnalysisId.get(afterId);
      if (root) addChild(root.id, ind, rel);
    }
    // (2) 가치사슬 연계(proxy_link) 경로 — 전방/전전방은 from이 앵커, 후방/후후방은 to가 앵커.
    for (const link of overview?.industryLinks ?? []) {
      const isDownstream = link.relation === "전방" || link.relation === "전전방";
      const rootId = isDownstream ? link.from_industry_id : link.to_industry_id;
      const childId = isDownstream ? link.to_industry_id : link.from_industry_id;
      const root = byIndustryId.get(rootId);
      const child = byIndustryId.get(childId);
      if (root && child) addChild(root.id, child, link.relation);
    }
    for (const list of childrenByRootId.values()) {
      list.sort((a, b) => (RELATION_ORDER[a.relation] ?? 9) - (RELATION_ORDER[b.relation] ?? 9));
    }
    const groups: Array<{ ind: IndustryRow; children: Array<{ ind: IndustryRow; relation: string }> }> = [];
    for (const ind of visibleIndustries) {
      if (childIds.has(ind.id)) continue;
      groups.push({ ind, children: childrenByRootId.get(ind.id) ?? [] });
    }
    return groups;
  }, [visibleIndustries, overview?.industryLinks]);

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
    const promoted = new Set<string>();
    const out: typeof industryGroups = [];
    for (const g of industryGroups) {
      if (g.ind.pinned) { out.push(g); continue; }
      for (const c of g.children) {
        if (c.ind.pinned && !promoted.has(c.ind.id)) {
          promoted.add(c.ind.id);
          out.push({ ind: c.ind, children: [] });
        }
      }
    }
    return out;
  }, [industryGroups, pinnedOnly]);
  const flatRows = useMemo(() => {
    const rows: Array<{ ind: IndustryRow; relation: string | null; childCount: number; expanded: boolean; onToggle: (() => void) | null }> = [];
    for (const g of displayedGroups) {
      const hasChildren = g.children.length > 0;
      const expanded = hasChildren && expandedGroups.has(g.ind.id);
      rows.push({ ind: g.ind, relation: null, childCount: g.children.length, expanded, onToggle: hasChildren ? () => toggleGroup(g.ind.id) : null });
      if (expanded) {
        for (const child of g.children) rows.push({ ind: child.ind, relation: child.relation, childCount: 0, expanded: false, onToggle: null });
      }
    }
    return rows;
  }, [displayedGroups, expandedGroups]);

  const statusCounts = useMemo(() => {
    const counts = { all: 0, in_progress: 0, completed: 0, stale: 0, pending: 0, failed: 0 };
    for (const ind of overview?.industries ?? []) {
      counts.all++;
      counts[buckets.of(ind)?.bucket ?? "pending"]++;
    }
    return counts;
  }, [overview, buckets]);
  return { statusCounts, visibleIndustries, flatRows, saveEdit, deleteIndustry };
}

export type MarketAnalysisStageState = ReturnType<typeof useMarketData> & ReturnType<typeof useMarketLinking> & ReturnType<typeof useMarketList>;
