// @version 1.1.0
/**
 * Portfolio scorecard tool — ADR-0101 §5 S11. Thin READ-ONLY REST wrapper
 * (ADR-0011) over /api/projects/:id/scorecard: the quarterly rollup
 * (bifurcated financial/strategic sections, class rollup,
 * insufficient_evidence exceptions, resolved_from provenance), the per-cycle
 * trend, and the append-only venture-portfolio-IC transition-decision
 * history. The transition-decision POST is deliberately NOT MCP-exposed:
 * recording an IC's decision is a governed act done through the procedure's
 * recorder flow, not an API convenience (design boundary #2).
 */

import type { RestPort } from "../shared/rest-port.ts";

export interface PortfolioScorecardEnvelope {
  project: { id: string; project_no: string };
  rollup: {
    review_cycle: string | null;
    resolved_from: "explicit" | "latest";
    financial: Array<Record<string, unknown>>;
    strategic: Array<Record<string, unknown>>;
    class_rollup: Array<Record<string, unknown>>;
    insufficient_evidence: Array<{ project_id: string; section: string; measure_key: string }>;
    provenance: { runs: string[]; review_cycles_available: string[] };
  };
  trend: Array<Record<string, unknown>>;
  decisions: { latest: Record<string, unknown> | null; history: Array<Record<string, unknown>> };
}

export async function getPortfolioScorecard(port: RestPort, projectId: string, reviewCycle?: string) {
  const query = reviewCycle ? `?review_cycle=${encodeURIComponent(reviewCycle)}` : "";
  return port.get<PortfolioScorecardEnvelope>(`/api/projects/${encodeURIComponent(projectId)}/scorecard${query}`);
}
