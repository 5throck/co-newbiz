// @version 1.0.0
/**
 * IC package tool — ADR-0100 S10. Thin READ-ONLY REST wrapper (ADR-0011) over
 * /api/projects/:id/ic-package. Only the implemented surface is exposed
 * (no-dead-endpoint principle): the aggregated read for IC reviewers —
 * adopted business case + simulations, DD completion, the AI-PROPOSED RAG
 * grade (labeled a proposal in the payload), entity_ic/group_ic gate history,
 * and establishment progress. The establishment PUT deliberately has no MCP
 * tool: step completion is a human-owned execution record (design boundary
 * #2, ADR-0100 §6).
 */

import { rest } from "../shared/rest-client.ts";

export interface IcPackageEnvelope {
  project: { id: string; project_no: string };
  business_case: {
    adopted: {
      id: string; name: string; kind: string; scenario: string | null; adopted: boolean;
      simulations: Array<{ scenario: string; percentile: string; npv_krw_m: number; irr: number | null }>;
    } | null;
    adoption: { modelId: string; adoptedBy: string; adoptedAt: string } | null;
    note?: string;
  };
  dd: {
    completion: { total: number; pending: number; mandatoryUnmet: number };
    findings: Array<Record<string, unknown>>;
    finding_count: number;
  };
  rag: {
    grade: "green" | "amber" | "red" | null;
    /** Always true — the AI grade is a proposal, never a human confirmation. */
    isProposal: true;
    rationale: string | null;
    assessed_at: string | null;
    confidence_cap: string | null;
    confidence_note: string | null;
  };
  gates: {
    latest: Array<{ gate: string; decision: "go" | "hold" | "kill" | null; rationale: string | null; missing_artifacts: string[] | null }>;
    history: Array<Record<string, unknown>>;
  };
  establishment: { steps: Array<Record<string, unknown>>; done: number; total: number; complete: boolean; progress: string };
}

export async function getProjectIcPackage(projectId: string) {
  return rest.get<IcPackageEnvelope>(`/api/projects/${encodeURIComponent(projectId)}/ic-package`);
}
