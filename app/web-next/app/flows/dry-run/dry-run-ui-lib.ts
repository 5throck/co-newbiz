// Pure helpers for the dry-run screens (2026-10-26 dry-run UX design §3/§5/§6).
// No React, no I/O: unit-tested in tests/unit/dry-run-ui-lib.test.ts.
import type { BlueprintAgent, DryRunSessionDetail } from "../flows-view-lib.ts";

// ── Detail tabs (hash-synced) ─────────────────────────────────────────────
export const DRY_RUN_TABS = ["edit", "run", "suggest", "history"] as const;
export type DryRunTab = (typeof DRY_RUN_TABS)[number];

export function tabFromHash(hash: string): DryRunTab | null {
  const key = hash.replace(/^#/, "");
  return (DRY_RUN_TABS as readonly string[]).includes(key) ? (key as DryRunTab) : null;
}

/** Default tab: "run" when the session already has runs, else "edit". */
export function defaultTab(hasRuns: boolean): DryRunTab {
  return hasRuns ? "run" : "edit";
}

// ── State-dependent primary action (design §3 table) ──────────────────────
export type DryRunAction = "run" | "apply" | "export";

export interface ActionPlan {
  primary: DryRunAction;
  /** Secondary actions, in "More" menu order. */
  secondary: DryRunAction[];
}

/**
 * No runs yet            -> Run          | Export, Apply
 * Runs + unsaved edit    -> Apply        | Run, Export
 * Runs + no pending edit -> Export       | Run again, Apply
 */
export function planActions(hasRuns: boolean, dirty: boolean): ActionPlan {
  if (!hasRuns) return { primary: "run", secondary: ["export", "apply"] };
  if (dirty) return { primary: "apply", secondary: ["run", "export"] };
  return { primary: "export", secondary: ["run", "apply"] };
}

/** The tab that owns the control behind an action (switch + focus target). */
export function tabForAction(action: DryRunAction): DryRunTab {
  return action === "apply" ? "edit" : "run";
}

// ── Agent picker (design §5) ──────────────────────────────────────────────
export const AGENT_DOMAIN_ORDER = ["functional", "technical", "industry", "region", "other"] as const;
export type AgentDomainGroup = (typeof AGENT_DOMAIN_ORDER)[number];

export function agentGroupOf(domain: string | null | undefined): AgentDomainGroup {
  return (AGENT_DOMAIN_ORDER as readonly string[]).includes(domain ?? "") && domain !== "other"
    ? (domain as AgentDomainGroup)
    : "other";
}

export interface AgentGroup {
  group: AgentDomainGroup;
  agents: BlueprintAgent[];
}

/** Filter by name / key / role (case-insensitive substring), then group in fixed domain order. Empty groups are dropped. */
export function groupAgents(agents: BlueprintAgent[], query: string): AgentGroup[] {
  const q = query.trim().toLowerCase();
  const hit = (a: BlueprintAgent) =>
    q === "" || a.key.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || (a.role ?? "").toLowerCase().includes(q);
  return AGENT_DOMAIN_ORDER.map((group) => ({
    group,
    agents: agents.filter((a) => agentGroupOf(a.domain) === group && hit(a)),
  })).filter((g) => g.agents.length > 0);
}

// ── List page (design §6) ─────────────────────────────────────────────────
/** Real session status values from the API (see DryRunSessionDetail.status). */
export const SESSION_STATUS_FILTERS = ["all", "active", "closed", "expired"] as const;
export type SessionStatusFilter = (typeof SESSION_STATUS_FILTERS)[number];

export function statusCounts(sessions: Pick<DryRunSessionDetail, "status">[]): Record<SessionStatusFilter, number> {
  const out: Record<SessionStatusFilter, number> = { all: sessions.length, active: 0, closed: 0, expired: 0 };
  for (const s of sessions) if (s.status === "active" || s.status === "closed" || s.status === "expired") out[s.status] += 1;
  return out;
}

export function filterSessions<T extends Pick<DryRunSessionDetail, "id" | "status" | "purpose" | "prompt_key" | "activity_id">>(
  sessions: T[],
  status: SessionStatusFilter,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  return sessions.filter((s) => {
    if (status !== "all" && s.status !== status) return false;
    if (q === "") return true;
    return [s.id, s.purpose, s.prompt_key, s.activity_id ?? ""].some((v) => v.toLowerCase().includes(q));
  });
}

/** Last 8 characters of a session id for dense display. Ids are `dr_<ulid>`: the ULID head is a timestamp shared by
 *  sessions created close together, so the random tail is what tells them apart (full id stays in title/copy). */
export function shortId(id: string): string {
  return id.slice(-8);
}
