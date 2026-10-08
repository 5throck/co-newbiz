// Pending-decisions inbox read model (Wave U-1, design §4). It merges existing
// permission-scoped APIs into one list and NEVER decides anything: every item
// carries an href to the existing human-only control (confirm page, gate panel,
// closure modal host). Boundary #2 holds by construction — there is no write
// call in this module. Boundary #1: the sources are the caller's own
// permission-scoped endpoints, so nothing outside need-to-know is returned.
//
// Coverage note (U-1): sources with a per-user "open for me" filter today are
// decision proposals, gate HOLDs, S12 closure/transition blockers and unread
// notifications. Checklist approvals and transition requests have no list
// endpoint yet; they are the documented reason a read-only GET /api/inbox
// aggregation route may be added later (design §13).

export type InboxKind =
  | "gate_proposal"
  | "decision_proposal"
  | "gate_hold"
  | "closure_precondition"
  | "notification";

export type InboxSeverity = "high" | "medium" | "low";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  dealId: string | null;
  entityType: "opportunity" | "project" | null;
  /** Gate id for gate proposals/HOLDs, so the detail pane can show ReviewBuckets. */
  gate?: string;
  dealName: string;
  stage: string | null;
  title: string;
  ageDays: number;
  severity: InboxSeverity;
  /** Existing human-only control or the source screen. */
  href: string;
  /** Clearly-labelled AI draft line; display only, never acts. */
  aiDraft?: string;
  /** ISO timestamp used for ordering/age. */
  createdAt: string;
}

export const KIND_LABEL: Record<InboxKind, string> = {
  gate_proposal: "게이트 결정 제안",
  decision_proposal: "결정 제안",
  gate_hold: "게이트 HOLD",
  closure_precondition: "종료·전환 선결조건",
  notification: "알림",
};

export const SEVERITY_LABEL: Record<InboxSeverity, string> = {
  high: "긴급",
  medium: "보통",
  low: "낮음",
};

const SEVERITY_RANK: Record<InboxSeverity, number> = { high: 0, medium: 1, low: 2 };

// ---- raw source shapes (subset of the existing API payloads) --------------
export interface ProposalSrc {
  id: string;
  kind: string;
  entity_type: "opportunity" | "project";
  entity_id: string;
  stage_id: string | null;
  payload: Record<string, unknown>;
  rationale: string;
  via_client_id: string | null;
  status: string;
  expires_at: string;
  created_at: string;
}
export interface PipelineProjectSrc {
  projectId: string;
  projectNo: string;
  projectName: string | null;
  currentStage: string | null;
  blockers: string[];
}
export interface HoldSrc {
  entityType: "opportunity" | "project";
  entityId: string;
  label: string;
  gate: string;
  decision: string;
  decidedAt: string;
  ageDays: number;
}
export interface PipelineSrc {
  projects: PipelineProjectSrc[];
  currentHolds: HoldSrc[];
}
export interface NotificationSrc {
  id: string;
  project_id: string | null;
  trigger_type: string;
  severity: "opportunity" | "warning" | "urgent" | "info" | "ops";
  payload: string;
  sent_at: string;
  read_at: string | null;
}

export interface InboxSources {
  proposals?: ProposalSrc[];
  pipeline?: PipelineSrc;
  notifications?: NotificationSrc[];
}

export function ageInDays(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

function dealNameOf(pipeline: PipelineSrc | undefined, id: string): string {
  const p = pipeline?.projects.find((x) => x.projectId === id);
  return p ? (p.projectName ?? p.projectNo) : id;
}

function proposalTitle(p: ProposalSrc): string {
  if (p.kind === "gate_decision") {
    const gate = String(p.payload.gate ?? "");
    const dec = String(p.payload.decision ?? "").toUpperCase();
    return `${gate} 게이트 — ${dec} 제안 확인`;
  }
  return `${p.kind.replaceAll("_", " ")} 제안 확인`;
}

function notificationSummary(n: NotificationSrc): string {
  try {
    const parsed = JSON.parse(n.payload) as { message?: unknown; title?: unknown };
    const text = parsed.message ?? parsed.title;
    if (typeof text === "string" && text.trim()) return text.trim();
  } catch {
    /* payload is free text */
  }
  return n.trigger_type.replaceAll("_", " ");
}

/** Pure merge — unit-tested. Sorted by severity, then oldest first. */
export function buildInbox(src: InboxSources, nowMs: number = Date.now()): InboxItem[] {
  const items: InboxItem[] = [];
  for (const p of src.proposals ?? []) {
    if (p.status !== "pending") continue;
    const age = ageInDays(p.created_at, nowMs);
    const hoursLeft = (Date.parse(p.expires_at) - nowMs) / 3_600_000;
    items.push({
      id: `proposal:${p.id}`,
      kind: p.kind === "gate_decision" ? "gate_proposal" : "decision_proposal",
      dealId: p.entity_id,
      entityType: p.entity_type,
      gate: p.kind === "gate_decision" ? String(p.payload.gate ?? "") || undefined : undefined,
      dealName: dealNameOf(src.pipeline, p.entity_id),
      stage: p.stage_id,
      title: proposalTitle(p),
      ageDays: age,
      severity: hoursLeft <= 24 ? "high" : "medium",
      href: `/proposals/${encodeURIComponent(p.id)}/confirm`,
      aiDraft: p.via_client_id && p.rationale ? p.rationale : undefined,
      createdAt: p.created_at,
    });
  }
  for (const h of src.pipeline?.currentHolds ?? []) {
    if (h.decision !== "hold") continue;
    items.push({
      id: `hold:${h.entityType}:${h.entityId}:${h.gate}`,
      kind: "gate_hold",
      dealId: h.entityId,
      entityType: h.entityType,
      gate: h.gate,
      dealName: h.label,
      stage: null,
      title: `${h.gate} 게이트 HOLD 해소 대기`,
      ageDays: h.ageDays,
      severity: h.ageDays >= 14 ? "high" : h.ageDays >= 7 ? "medium" : "low",
      href: h.entityType === "project" ? `/projects/${encodeURIComponent(h.entityId)}/process` : `/opportunities/${encodeURIComponent(h.entityId)}`,
      createdAt: h.decidedAt,
    });
  }
  for (const p of src.pipeline?.projects ?? []) {
    if (p.currentStage !== "S12" || p.blockers.length === 0) continue;
    items.push({
      id: `closure:${p.projectId}`,
      kind: "closure_precondition",
      dealId: p.projectId,
      entityType: "project",
      dealName: p.projectName ?? p.projectNo,
      stage: "S12",
      title: `선결조건 미충족: ${p.blockers[0]}`,
      ageDays: 0,
      severity: "medium",
      href: `/projects/${encodeURIComponent(p.projectId)}/portfolio`,
      createdAt: new Date(nowMs).toISOString(),
    });
  }
  for (const n of src.notifications ?? []) {
    if (n.read_at !== null) continue;
    items.push({
      id: `notification:${n.id}`,
      kind: "notification",
      dealId: n.project_id,
      entityType: n.project_id ? "project" : null,
      dealName: n.project_id ? dealNameOf(src.pipeline, n.project_id) : "—",
      stage: null,
      title: notificationSummary(n),
      ageDays: ageInDays(n.sent_at, nowMs),
      severity: n.severity === "urgent" ? "high" : n.severity === "warning" ? "medium" : "low",
      href: n.project_id ? `/projects/${encodeURIComponent(n.project_id)}/process` : "/deals",
      createdAt: n.sent_at,
    });
  }
  return items.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
}

export interface InboxLoadResult {
  items: InboxItem[];
  /** Kinds whose source failed — surfaced as an inline "could not load" row, never silent. */
  failed: Array<{ source: "proposals" | "pipeline" | "notifications"; message: string }>;
}

type Getter = <T>(path: string) => Promise<{ data: T }>;

/** Fetches every source in parallel; a failing source degrades to a failed[] entry. */
export async function loadInbox(get: Getter, nowMs: number = Date.now()): Promise<InboxLoadResult> {
  const [proposals, pipeline, notifications] = await Promise.allSettled([
    get<ProposalSrc[]>("/api/proposals?status=pending"),
    get<PipelineSrc>("/api/portfolio/pipeline"),
    get<NotificationSrc[]>("/api/notifications"),
  ]);
  const failed: InboxLoadResult["failed"] = [];
  const val = <T,>(name: InboxLoadResult["failed"][number]["source"], r: PromiseSettledResult<{ data: T }>): T | undefined => {
    if (r.status === "fulfilled") return r.value.data;
    failed.push({ source: name, message: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    return undefined;
  };
  const sources: InboxSources = {
    proposals: val("proposals", proposals),
    pipeline: val("pipeline", pipeline),
    notifications: val("notifications", notifications),
  };
  return { items: buildInbox(sources, nowMs), failed };
}
