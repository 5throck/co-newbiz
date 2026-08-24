// @version 1.0.0
/**
 * Value-chain topology resolver (ADR-0066 design, Phase A).
 *
 * Interprets a project's value_chain_link rows as a directed industry graph
 * (from_industry → to_industry) and returns upstream→end-market layers via
 * Kahn's-algorithm layering. Cycles are an error — a value chain with cyclic
 * dependency is malformed data, never something to silently untangle.
 */

import type { Database } from "bun:sqlite";

export interface ChainLinkRow {
  id: string;
  from_industry_id: string;
  to_industry_id: string;
  direction: "upstream" | "downstream";
  elasticity: number | null;
  pass_through_rate: number | null;
}

export interface ChainTopology {
  /** Industries grouped upstream→downstream; layer 0 = pure origin nodes. */
  layers: Array<{ layer: number; industryIds: string[] }>;
  links: ChainLinkRow[];
  nodeCount: number;
}

export function resolveChainTopology(db: Database, projectId: string): ChainTopology {
  const links = db
    .query(
      "SELECT id, from_industry_id, to_industry_id, direction, elasticity, pass_through_rate FROM value_chain_link WHERE project_id = ? ORDER BY id",
    )
    .all(projectId) as unknown as ChainLinkRow[];

  const nodes = new Set<string>();
  for (const l of links) {
    nodes.add(l.from_industry_id);
    nodes.add(l.to_industry_id);
  }

  // Kahn layering over from→to edges.
  const outDegreeTarget = new Map<string, number>();
  const successors = new Map<string, string[]>([...nodes].map((n) => [n, []]));
  for (const n of nodes) outDegreeTarget.set(n, 0);
  for (const l of links) {
    successors.get(l.from_industry_id)!.push(l.to_industry_id);
  }
  const dependents = new Map<string, number>([...nodes].map((n) => [n, 0]));
  for (const l of links) dependents.set(l.from_industry_id, (dependents.get(l.from_industry_id) ?? 0) + 1);

  // layer[node] = longest path length from any pure-origin node (in-degree 0).
  const inDeg = new Map(dependents);
  let frontier = [...nodes].filter((n) => (inDeg.get(n) ?? 0) === 0);
  const layerOf = new Map<string, number>(frontier.map((n) => [n, 0]));
  let layer = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const u of frontier) {
      for (const v of successors.get(u)!) {
        const candidate = (layerOf.get(u) ?? 0) + 1;
        if ((layerOf.get(v) ?? -1) < candidate) layerOf.set(v, candidate);
        inDeg.set(v, (inDeg.get(v) ?? 1) - 1);
        if ((inDeg.get(v) ?? 0) === 0) next.push(v);
      }
    }
    frontier = next;
    layer += 1;
  }

  if (layerOf.size !== nodes.size) {
    const stuck = [...nodes].filter((n) => !layerOf.has(n));
    throw new Error(`value-chain topology: cycle detected among industries (${stuck.length} unresolved nodes) — fix value_chain_link rows.`);
  }

  const byLayer = new Map<number, string[]>();
  for (const [node, l] of layerOf) {
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(node);
  }

  return {
    layers: [...byLayer.entries()].sort((a, b) => a[0] - b[0]).map(([l, ids]) => ({ layer: l, industryIds: ids.sort() })),
    links,
    nodeCount: nodes.size,
  };
}
