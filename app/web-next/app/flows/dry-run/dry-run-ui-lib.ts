// Pure helpers for the dry-run screens (2026-10-26 dry-run UX design §3/§5/§6).
// No React, no I/O: unit-tested in tests/unit/dry-run-ui-lib.test.ts.
import type { BlueprintAgent, DryRunSessionDetail } from "../flows-view-lib.ts";

// ── Single-page session helpers (2026-10-26b delta) ───────────────────────
export type DryRunPrimary = "run" | "export";

/** Summary-bar primary: Run until the first run, Export package afterwards; a dirty buffer always means Run (as a new session). */
export function primaryAction(runCount: number, dirty = false): DryRunPrimary {
  return runCount > 0 && !dirty ? "export" : "run";
}

/** The override axis the editor buffer would save: text equal to base (or blank) means "no prompt override". */
export function effectiveOverrideSystem(buffer: string, baseSystem: string): string | null {
  const trimmed = buffer.trim();
  return trimmed === "" || trimmed === baseSystem.trim() ? null : buffer;
}

/** Editor buffer differs from the saved session override (text or agent axis). */
export function isDirty(
  buffer: { system: string; agentKey: string },
  saved: { override_system: string | null; override_agent_key: string | null; base_system: string },
): boolean {
  return (
    effectiveOverrideSystem(buffer.system, saved.base_system) !== (saved.override_system ?? null) ||
    (buffer.agentKey || null) !== (saved.override_agent_key ?? null)
  );
}

export interface DiffRow {
  kind: "same" | "add" | "del";
  text: string;
}

/** Line diff (LCS) between the editor buffer and a proposal: rows in reading order. */
export function lineDiffRows(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "del", text: a[i++] });
    else out.push({ kind: "add", text: b[j++] });
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return out;
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
