// Agent-domain resolution and cross-domain reviewer selection (ADR-0153).
// An agent's domain comes from its `domain:` frontmatter (agents/*.md, synced
// from AGENTS.md by sync-agent-personas.ts, projected into the generated
// registry). The AI 2nd reviewer must come from a DIFFERENT domain than the
// authoring agents — a same-domain review shares the author's blind spots and
// counts only as first stage. An unresolvable domain means the stage is NOT
// PERFORMED; it is never downgraded to a same-domain review.
//
// ADR-0187 P4 (M7/M8, D3): the reviewer is chosen by artifact type x author
// domain from process/cross-validation-matrix.yaml (projected to
// review-matrix.generated.ts). DEFAULT_REVIEWER_DOMAIN is now only the labelled
// fallback (fallbackUsed) when the matrix names no usable cross-domain reviewer.
import { AGENT_REGISTRY } from "../agent-registry.generated.ts";
import { REVIEW_MATRIX } from "./review-matrix.generated.ts";

export type ReviewDomain = "functional" | "technical" | "industry" | "region";

export const REVIEW_DOMAINS: readonly ReviewDomain[] = ["functional", "technical", "industry", "region"];

/** Domain lead persona that performs the AI 2nd review for a domain. */
export const DOMAIN_LEAD: Record<ReviewDomain, string> = {
  functional: "process-governance-manager",
  technical: "platform-lead",
  industry: "industry-lead",
  region: "region-lead",
};

/** Default cross-validation mapping (design §4.3): the labelled fallback when the matrix has no usable entry. */
export const DEFAULT_REVIEWER_DOMAIN: Record<ReviewDomain, ReviewDomain> = {
  functional: "technical",
  technical: "functional",
  industry: "region",
  region: "industry",
};

export interface ReviewMatrix {
  version: string;
  fallback: Record<string, string>;
  reviewerDomains: Record<string, string>;
  /** Agents without a review domain that are excluded from author-domain calculation (e.g. pm). */
  agentExemptions: string[];
  gateExceptions: string[];
  artifactTypes: Record<string, { reviewers: Record<string, string>; rationale: string }>;
  stages: Record<string, { defaultType: string; required: Array<{ match: string; artifactType: string }> }>;
}

export const MATRIX: ReviewMatrix = REVIEW_MATRIX;

/** Type used when the caller names none (gate-level bundles and legacy callers). */
export const DEFAULT_ARTIFACT_TYPE = "bundle";

const normText = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Artifact type of a stage's requiredArtifacts entry, from the matrix stage typing. */
export function artifactTypeFor(stageId: string, artifactName: string, matrix: ReviewMatrix = MATRIX): string {
  const st = matrix.stages[stageId];
  if (!st) return DEFAULT_ARTIFACT_TYPE;
  const name = normText(artifactName);
  return st.required.find((r) => name.startsWith(normText(r.match)))?.artifactType ?? st.defaultType;
}

export function agentDomain(agentKey: string): ReviewDomain | null {
  const d = AGENT_REGISTRY.find((a) => a.key === agentKey)?.domain;
  return d && (REVIEW_DOMAINS as readonly string[]).includes(d) ? (d as ReviewDomain) : null;
}

export type ReviewerSelection =
  | {
      ok: true;
      reviewerAgent: string;
      reviewerDomain: ReviewDomain;
      authorDomain: ReviewDomain;
      authorDomains: ReviewDomain[];
      unresolvedAgents: string[];
      /** Authors excluded by an explicit matrix exemption (pm). */
      exemptAgents: string[];
      artifactType: string;
      /** True when the matrix named no usable cross-domain reviewer and the default lead was used. */
      fallbackUsed: boolean;
      fallbackReason: string | null;
      /** Same-domain reviewer named by the matrix: first-stage specialist only, never the AI-2nd seat. */
      firstStageSpecialist: string | null;
    }
  | {
      ok: false;
      reason: string;
      authorDomain: ReviewDomain | null;
      unresolvedAgents: string[];
      exemptAgents: string[];
    };

/**
 * Pick the AI 2nd reviewer for an artifact authored by `authorAgents`.
 * `artifactType` selects the matrix row (default: the multi-type "bundle").
 */
export function selectReviewer(
  authorAgents: readonly string[],
  ctx: { artifactType?: string } = {},
  matrix: ReviewMatrix = MATRIX,
): ReviewerSelection {
  const unique = [...new Set(authorAgents)].sort();
  const counts = new Map<ReviewDomain, number>();
  const unresolvedAgents: string[] = [];
  const exemptAgents: string[] = [];
  for (const agent of unique) {
    if (matrix.agentExemptions.includes(agent)) {
      exemptAgents.push(agent);
      continue;
    }
    const d = agentDomain(agent);
    if (d === null) unresolvedAgents.push(agent);
    else counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return { ok: false, reason: "reviewer domain unresolved", authorDomain: null, unresolvedAgents, exemptAgents };
  }
  const authorDomains = [...counts.keys()].sort();
  const primary = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const artifactType = ctx.artifactType ?? DEFAULT_ARTIFACT_TYPE;
  const domainOf = (agent: string): string | null => matrix.reviewerDomains[agent] ?? agentDomain(agent);

  const matrixReviewer = matrix.artifactTypes[artifactType]?.reviewers[primary] ?? null;
  const fallbackReviewer = matrix.fallback[primary] ?? DOMAIN_LEAD[DEFAULT_REVIEWER_DOMAIN[primary]];
  const usable = (agent: string | null): agent is string => {
    const d = agent ? domainOf(agent) : null;
    return !!agent && d !== null && !authorDomains.includes(d as ReviewDomain);
  };

  let reviewerAgent: string | null = null;
  let fallbackUsed = false;
  let fallbackReason: string | null = null;
  let firstStageSpecialist: string | null = null;
  if (usable(matrixReviewer)) {
    reviewerAgent = matrixReviewer;
  } else {
    if (matrixReviewer && domainOf(matrixReviewer) === primary) firstStageSpecialist = matrixReviewer;
    fallbackReason = !matrixReviewer
      ? `no matrix entry for artifact type '${artifactType}' x author domain '${primary}'`
      : `matrix reviewer '${matrixReviewer}' is not cross-domain for authors in ${authorDomains.join(", ")} (counts as first stage only)`;
    if (usable(fallbackReviewer)) {
      reviewerAgent = fallbackReviewer;
      fallbackUsed = true;
    }
  }
  if (!reviewerAgent) {
    return {
      ok: false,
      reason: `no cross-domain reviewer: authors span ${authorDomains.join(", ")} and no matrix or fallback reviewer outside those domains exists`,
      authorDomain: primary,
      unresolvedAgents,
      exemptAgents,
    };
  }
  return {
    ok: true,
    reviewerAgent,
    reviewerDomain: domainOf(reviewerAgent) as ReviewDomain,
    authorDomain: primary,
    authorDomains,
    unresolvedAgents,
    exemptAgents,
    artifactType,
    fallbackUsed,
    fallbackReason: fallbackUsed ? fallbackReason : null,
    firstStageSpecialist,
  };
}
