// Pure list-shaping helpers extracted from useMarketList.ts so tests (and the
// deal-context split) can exercise them without importing React hook modules.
// No "use client", no framework imports — data in, data out.
import type { IndustryRow, IndustryLink } from "./types.ts";

export interface IndustryGroup { ind: IndustryRow; children: Array<{ ind: IndustryRow; relation: string }> }
export interface FlatIndustryRow { ind: IndustryRow; relation: string | null; childCount: number; expanded: boolean; onToggle: (() => void) | null }

export const RELATION_ORDER: Record<string, number> = { "전전방": 0, "전방": 1, "후방": 2, "후후방": 3 };

export function buildIndustryGroups(
  visibleIndustries: IndustryRow[],
  industryLinks: IndustryLink[] | undefined,
): IndustryGroup[] {
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
  // (1) 연계 큐 경로 — after_analysis_id 앵커로 등록된 '연계 대기/이어서 분석' 산업.
  for (const ind of visibleIndustries) {
    const rel = ind.analysis?.linked_relation;
    const afterId = ind.analysis?.after_analysis_id;
    if (!rel || !afterId) continue;
    const root = byAnalysisId.get(afterId);
    if (root) addChild(root.id, ind, rel);
  }
  // (2) 가치사슬 연계(proxy_link) 경로 — 전방/전전방은 from이 앵커, 후방/후후방은 to가 앵커.
  for (const link of industryLinks ?? []) {
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
  const groups: IndustryGroup[] = [];
  for (const ind of visibleIndustries) {
    if (childIds.has(ind.id)) continue;
    groups.push({ ind, children: childrenByRootId.get(ind.id) ?? [] });
  }
  return groups;
}

export function flattenGroups(
  groups: IndustryGroup[],
  expandedGroups: Set<string>,
  toggleGroup: (rootId: string) => void,
): FlatIndustryRow[] {
  const rows: FlatIndustryRow[] = [];
  for (const g of groups) {
    const hasChildren = g.children.length > 0;
    const expanded = hasChildren && expandedGroups.has(g.ind.id);
    rows.push({ ind: g.ind, relation: null, childCount: g.children.length, expanded, onToggle: hasChildren ? () => toggleGroup(g.ind.id) : null });
    if (expanded) {
      for (const child of g.children) rows.push({ ind: child.ind, relation: child.relation, childCount: 0, expanded: false, onToggle: null });
    }
  }
  return rows;
}

/**
 * Deal-context split (decider-approved navigation fix, 2026-10-16): the group
 * travels with its ANCHOR — a linked anchor keeps its value-chain children in
 * the linked section, an unlinked anchor keeps its whole group in the
 * "다른 검토의 산업 분석" section. linkedIds === null means "not in a deal
 * context" → nothing is split.
 */
export function splitGroups(
  groups: IndustryGroup[],
  linkedIds: Set<string> | null,
): { linked: IndustryGroup[]; other: IndustryGroup[] } {
  if (!linkedIds) return { linked: groups, other: [] };
  const linked: IndustryGroup[] = [];
  const other: IndustryGroup[] = [];
  for (const g of groups) (linkedIds.has(g.ind.id) ? linked : other).push(g);
  return { linked, other };
}

/** Pin filter extracted alongside — promoted children keep their single-parent assumption. */
export function filterPinned(groups: IndustryGroup[]): IndustryGroup[] {
  const promoted = new Set<string>();
  const out: IndustryGroup[] = [];
  for (const g of groups) {
    if (g.ind.pinned) { out.push(g); continue; }
    for (const c of g.children) {
      if (c.ind.pinned && !promoted.has(c.ind.id)) {
        promoted.add(c.ind.id);
        out.push({ ind: c.ind, children: [] });
      }
    }
  }
  return out;
}
