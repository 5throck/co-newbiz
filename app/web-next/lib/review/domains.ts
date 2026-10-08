// Agent-domain resolution and cross-domain reviewer selection (ADR-0153).
// An agent's domain comes from its `domain:` frontmatter (agents/*.md, synced
// from AGENTS.md by sync-agent-personas.ts, projected into the generated
// registry). The AI 2nd reviewer must come from a DIFFERENT domain than the
// authoring agents — a same-domain review shares the author's blind spots and
// counts only as first stage. An unresolvable domain means the stage is NOT
// PERFORMED; it is never downgraded to a same-domain review.
import { AGENT_REGISTRY } from "../agent-registry.generated.ts";

export type ReviewDomain = "functional" | "technical" | "industry" | "region";

export const REVIEW_DOMAINS: readonly ReviewDomain[] = ["functional", "technical", "industry", "region"];

/** Domain lead persona that performs the AI 2nd review for a domain. */
export const DOMAIN_LEAD: Record<ReviewDomain, string> = {
  functional: "process-governance-manager",
  technical: "platform-lead",
  industry: "industry-lead",
  region: "region-lead",
};

/** Default cross-validation mapping (design §4.3) used when no matrix entry exists. */
export const DEFAULT_REVIEWER_DOMAIN: Record<ReviewDomain, ReviewDomain> = {
  functional: "technical",
  technical: "functional",
  industry: "region",
  region: "industry",
};

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
    }
  | { ok: false; reason: string; authorDomain: ReviewDomain | null; unresolvedAgents: string[] };

/** Pick the AI 2nd reviewer for an artifact authored by `authorAgents`. */
export function selectReviewer(authorAgents: readonly string[]): ReviewerSelection {
  const unique = [...new Set(authorAgents)].sort();
  const counts = new Map<ReviewDomain, number>();
  const unresolvedAgents: string[] = [];
  for (const agent of unique) {
    const d = agentDomain(agent);
    if (d === null) unresolvedAgents.push(agent);
    else counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return { ok: false, reason: "reviewer domain unresolved", authorDomain: null, unresolvedAgents };
  }
  const authorDomains = [...counts.keys()].sort();
  const primary = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const reviewerDomain = DEFAULT_REVIEWER_DOMAIN[primary];
  if (authorDomains.includes(reviewerDomain)) {
    return {
      ok: false,
      reason: `no cross-domain reviewer: authors span ${authorDomains.join(", ")} and the default reviewer domain ${reviewerDomain} is among them`,
      authorDomain: primary,
      unresolvedAgents,
    };
  }
  return {
    ok: true,
    reviewerAgent: DOMAIN_LEAD[reviewerDomain],
    reviewerDomain,
    authorDomain: primary,
    authorDomains,
    unresolvedAgents,
  };
}
