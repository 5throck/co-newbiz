// dd-checklist-tailor — S9 industry-tailored DD checklist proposals (ADR-0099
// §2). Per domain the S9 activity owner proposes 5–10 industry-tailored
// ADDITIONAL checklist items through the ADR-0096 runActivityChain engine —
// one process_run (entity = project, stage s9_dd_checklist_tailoring), one
// activity_run/agent_run per domain, so generation is auditable end to end
// exactly like S8 case generation.
//
//   commercial → commercial-dd-agent     technical → technical-dd-agent
//   legal      → legal-counsel
//
// Honesty constraint (ADR-0099 §6, binding): the DETERMINISTIC default
// executor derives items from the project's bound industry profile and MUST
// set source_url = null and source_reliability = 'C' — visibly unsourced,
// visibly lowest-confidence. It never fabricates a plausible-looking URL or
// grade; an unsourced proposal renders as unsourced in the UI and can still
// be approved by a human who judges it worthwhile on its own terms — it can
// never APPEAR sourced. The CO_NEWBIZ_DD_TAILOR_AGENTS=llm seam
// (setDdTailorExecutorFactory) is the documented insertion point for a
// WebSearch-backed implementation that upgrades provenance without changing
// any table, route, or predicate.
//
// Boundary #2 (design, non-negotiable): this engine writes PROPOSALS only —
// every item lands in status 'proposed' with no project_checklist_item_state
// row. Approval (which moves the item into the gate-relevant judgment set) is
// the human review path in reviewDdCustomItem(); the engine can never promote
// its own proposal, and an unapproved proposal cannot block a gate.

import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { AGENT_KEYS } from "./agent-registry.generated.ts";
import { runActivityChain, type ActivitySpec, type EntityRef } from "./agent-orchestrator.ts";
import { specAgentFor } from "./spec-activities.ts";
import { DD_WORKSPACE_CHECKLISTS, SUB_TRACK_DD_CHECKLISTS, scopedSubTrackDdChecklists, getChecklistItems, type ChecklistItemDef } from "./library.ts";
import { WAVE_F_PREDICATE_DATE } from "./wave-f-date.ts";
import { DD_DOMAIN_LABEL } from "./labels.ts";
import {
  greenfieldSelection,
  hypotheticalWorkspaceScope,
  planReadinessRows,
  previousScopeEntries,
  scopedChecklistItems,
  stepTabMap,
  workspaceOverlay,
  workspaceScopeContext,
  type GreenfieldSelection,
  type PlanReadinessRow,
  type PreviousScopeEntry,
  type StepTag,
  type WorkspaceItemScope,
  type WorkspaceScopeContext,
  type WorkspaceScopeKey,
} from "./greenfield-subtrack.ts";
import {
  BF_WS_POLICY_DOC_ID,
  brownfieldExtraItems,
  brownfieldPreviousScope,
  brownfieldRouteInfo,
  brownfieldScopeContext,
  hypotheticalBrownfieldScope,
  type BrownfieldScopeContext,
  type BrownfieldScopeKey,
} from "./brownfield-subtrack.ts";
import { DdTargetError, selectedTargetId, type DdTargetSummary } from "./dd-target.ts";
import { isWebResearchConfigured, tavilySearch, type WebSource } from "./web-research.ts";

// ADR-0148 — DD workspace is 7 domains (financial/hr/market/financing added
// alongside commercial/technical/legal).
export const DD_DOMAINS = [
  "commercial", "technical", "legal", "financial", "hr", "market", "financing",
] as const;
export type DdDomain = (typeof DD_DOMAINS)[number];

/**
 * Domains with industry-tailoring templates (TEMPLATES below). Custom items may
 * exist on all seven DD_DOMAINS since migration 0137 widened the
 * project_checklist_item_custom.domain CHECK, but automated tailoring stays on
 * these three until templates exist for financial/hr/market/financing; custom
 * items on those four are human-proposed (createDdCustomItem).
 */
export const DD_TAILOR_DOMAINS = ["commercial", "technical", "legal"] as const;
export type DdTailorDomain = (typeof DD_TAILOR_DOMAINS)[number];

/** ADR-0099 §2 — per-domain S9 activity owner, read from process/flow.spec.yaml
 * (SSOT, ADR-0074) via the domain→spec-activity mapping below. The four
 * ADR-0148 domains map to S9 activities being added to the spec; while an id
 * is not yet declared there, the owner falls back to DD_DOMAIN_AGENT_FALLBACK. */
export const DD_DOMAIN_TO_SPEC_ACTIVITY: Record<DdDomain, string> = {
  commercial: "commercial-dd",
  technical: "technical-dd",
  legal: "legal-dd",
  financial: "financial-dd",
  hr: "hr-dd",
  market: "market-dd",
  financing: "financing-dd",
};

/** Owners of the four ADR-0148 domains used when their S9 spec activity is not (yet) declared. */
const DD_DOMAIN_AGENT_FALLBACK: Record<"financial" | "hr" | "market" | "financing", string> = {
  financial: "financial-analyst",
  hr: "hr-integration-agent",
  market: "market-intelligence-agent",
  financing: "financing-agent",
};

export const DD_DOMAIN_AGENTS: Record<DdDomain, string> = Object.fromEntries(
  DD_DOMAINS.map((d) => {
    const fallback = DD_DOMAIN_AGENT_FALLBACK[d as keyof typeof DD_DOMAIN_AGENT_FALLBACK];
    try {
      return [d, specAgentFor("S9", DD_DOMAIN_TO_SPEC_ACTIVITY[d])];
    } catch (err) {
      // A missing spec activity only falls back for the four ADR-0148 domains.
      if (fallback) return [d, fallback];
      throw err;
    }
  }),
) as Record<DdDomain, string>;

export const DD_TAILOR_STAGE = "s9_dd_checklist_tailoring";
/** ADR-0157: tailoring runs for opened comparison targets (kept apart from the selected scope's guard). */
export const DD_TAILOR_TARGET_STAGE = "s9_dd_checklist_tailoring_target";
/** checklist_id prefix under which an APPROVED custom item gets its judgment state row. */
export const CUSTOM_CHECKLIST_PREFIX = "custom:";

export function customChecklistId(domain: DdDomain): string {
  return `${CUSTOM_CHECKLIST_PREFIX}${domain}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── Industry resolution (deterministic input to the default executor) ──────

/** The industry label proposals are tailored to — live project_industry binding first, then the promoting opportunity's market scope. */
export function industryLabelForProject(projectId: string): string {
  const db = getDb();
  const bound = db
    .query(
      `SELECT i.name_en, i.name_ko FROM project_industry pi
       JOIN md_industry i ON i.id = pi.industry_id
       WHERE pi.project_id = ? AND pi.superseded_by IS NULL
       ORDER BY pi.bound_at DESC LIMIT 1`,
    )
    .get(projectId) as { name_en: string | null; name_ko: string } | undefined;
  if (bound) return bound.name_en ?? bound.name_ko;
  const scope = db
    .query(
      `SELECT o.market_scope FROM md_project p JOIN opportunity o ON o.id = p.source_opportunity_id
       WHERE p.id = ? AND o.market_scope IS NOT NULL LIMIT 1`,
    )
    .get(projectId) as { market_scope: string } | undefined;
  return scope?.market_scope ?? "the target's industry";
}

// ── Deterministic proposal templates (English content, industry-interpolated) ──

const TEMPLATES: Record<DdTailorDomain, Array<{ label: string; rationale: string }>> = {
  commercial: [
    { label: "Assess revenue concentration on the top-3 customers in {industry} against signed contracts, not management statements", rationale: "Industry-specific customer concentration is a common blind spot of the generic floor items; verify shares contractually." },
    { label: "Benchmark {industry} pricing power and cost pass-through evidence across the last downturn", rationale: "Generic pricing-power questions need an industry benchmark reference point to be answerable." },
    { label: "Map the {industry} channel structure and confirm distributor economics, rebates, and channel inventory", rationale: "Channel-heavy industries hide demand inflation in channel inventory; the floor items do not force this." },
    { label: "Test {industry} demand cyclicality against the proxy-chain demand estimate used in the S8 business case", rationale: "Ties DD back to the S8 demand anchor so a wrong market assumption surfaces as a DD finding." },
    { label: "Review announced {industry} competitor capacity expansions and substitution threats to the target's share", rationale: "Forward capacity announcements precede margin compression well before it shows in financials." },
  ],
  technical: [
    { label: "Verify {industry} process bottlenecks by physical observation, not management walkthroughs alone", rationale: "Floor item tdd-04 asks that bottlenecks are identified; for this industry the identification method matters." },
    { label: "Assess equipment age and maintenance backlog against {industry} reinvestment norms", rationale: "Deferred maintenance risk is industry-specific in scale and lead time." },
    { label: "Confirm {industry}-specific line certifications/qualifications and their renewal status", rationale: "A qualification lapse is a sales stop in regulated industries — feed certification-agent, do not duplicate." },
    { label: "Review {industry} EHS liabilities including site contamination history and permit-to-operate conditions", rationale: "Floor tdd-06 is generic; the industry defines which EHS exposures are material." },
    { label: "Validate the capex plan against {industry} benchmark unit costs and equipment lead times", rationale: "Capex realism is only checkable against industry-level unit costs." },
  ],
  legal: [
    { label: "Classify every {industry} business licence: transfers automatically / requires consent / must be re-issued on change of control", rationale: "Industry licence portability is the single most common structural legal risk; floor ldd-15 asks for this only generically." },
    { label: "Check {industry}-specific regulatory investigations and sanction exposure of the target and its beneficial owners", rationale: "Regulated industries carry sector-specific investigation risk the generic scan can miss." },
    { label: "Review the {industry} IP title chain and encumbrances including trade-secret protection practice", rationale: "What counts as protectable IP differs sharply by industry." },
    { label: "Assess the {industry} labor structure — union CBA successorship clauses and key-person dependencies", rationale: "Labor-transfer doctrine and CBA exposure are industry-shaped." },
    { label: "Scan top {industry} customer/supplier contracts for change-of-control and anti-assignment clauses", rationale: "Prioritizes the contract scan to the counterparties that actually matter in this industry." },
  ],
};

function renderTemplates(domain: DdTailorDomain, industry: string) {
  return TEMPLATES[domain].map((t) => ({
    itemLabel: t.label.replace("{industry}", industry),
    rationale: t.rationale.replace("{industry}", industry),
  }));
}

// ── Executor seam (ADR-0098 pattern) ───────────────────────────────────────

export interface TailorItemDraft {
  itemLabel: string;
  rationale: string;
  sourceUrl: string | null;
  sourceReliability: "A" | "B" | "C" | null;
}

/**
 * A domain executor produces the tailored item drafts for one domain. The
 * default (deterministic) implementation is HONEST-BY-DEFAULT: it may set
 * sourceUrl/sourceReliability only to null/'C' — no fabricated URLs or
 * grades. A WebSearch-backed factory returns real sources with real grades.
 */
export type DdTailorExecutor = (domain: DdTailorDomain, ctx: { projectId: string; industry: string }) => Promise<TailorItemDraft[]>;

type DdExecutorFactory = () => DdTailorExecutor;

let executorFactory: DdExecutorFactory | null = null;

/**
 * The seam: a future WebSearch-backed implementation registers a factory here
 * at server bootstrap. Active only when CO_NEWBIZ_DD_TAILOR_AGENTS=llm — the
 * default and any fallback is the local deterministic executor.
 */
export function setDdTailorExecutorFactory(next: DdExecutorFactory | null): void {
  executorFactory = next;
}

function persistDrafts(projectId: string, domain: DdTailorDomain, agentKey: string, drafts: TailorItemDraft[], targetId: string | null): void {
  const db = getDb();
  const now = nowIso();
  for (const d of drafts) {
    if (!d.itemLabel?.trim()) continue; // never persist an empty proposal
    db.run(
      `INSERT INTO project_checklist_item_custom
         (id, project_id, domain, item_label, rationale, source_url, source_reliability, proposed_by_agent, status, created_at, target_id)
       VALUES (?,?,?,?,?,?,?,?, 'proposed', ?, ?)`,
      [ulid(), projectId, domain, d.itemLabel.trim(), d.rationale?.trim() ?? null, d.sourceUrl ?? null, d.sourceReliability ?? null, agentKey, now, targetId],
    );
  }
}


/** 출처 URL의 신뢰도 등급 — 정부·교육·통계·공시 A, 주요 글로벌 언론·컨설팅 B, 기타 C.
 * (S6 웹검색 후보 제안에서도 재사용 — ADR-0118 근거 표시 계약) */
export function reliabilityForSource(url: string): "A" | "B" | "C" {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith(".gov") || host.endsWith(".go.kr") || host.endsWith(".edu") || host.includes("kosis") || host.includes("dart.fss")) return "A";
    if (host.includes("reuters") || host.includes("bloomberg") || host.includes("ft.com") || host.includes("mckinsey") || host.includes("bcg") || host.includes("pwc") || host.includes("deloitte") || host.includes("kpmg") || host.includes("ey.com")) return "B";
    return "C";
  } catch {
    return "C";
  }
}

function pickSource(sources: WebSource[], index: number): WebSource | null {
  if (sources.length === 0) return null;
  return sources[index % sources.length] ?? null;
}

export function makeTavilyDdTailorExecutor(search: typeof tavilySearch = tavilySearch): DdTailorExecutor {
  return async (domain, ctx) => {
    const templates = renderTemplates(domain, ctx.industry);
    const sources = await search(`${ctx.industry} ${domain} due diligence risks regulations market 2026`, { maxResults: 5 });
    return templates.map((t, index) => {
      const source = pickSource(sources, index);
      return {
        ...t,
        sourceUrl: source?.url ?? null,
        sourceReliability: source?.url ? reliabilityForSource(source.url) : "C",
      };
    });
  };
}

/** Deterministic default — profile-derived drafts, source_url null, grade 'C'. */
function defaultExecutor(): DdTailorExecutor {
  return async (domain, ctx) =>
    renderTemplates(domain, ctx.industry).map((t) => ({
      ...t,
      sourceUrl: null,
      // Honesty constraint (ADR-0099 §6): unsourced and visibly lowest-confidence.
      sourceReliability: "C" as const,
    }));
}

export function getDdTailorExecutor(): DdTailorExecutor {
  const mode = process.env.CO_NEWBIZ_DD_TAILOR_AGENTS ?? "deterministic";
  if (mode === "llm" && executorFactory !== null) return executorFactory();
  if (mode === "tavily" && isWebResearchConfigured()) return makeTavilyDdTailorExecutor();
  return defaultExecutor();
}

// ── The chain (one process_run, one activity per requested domain) ─────────

export interface TailorResult {
  processRunId: string;
  status: "running" | "done" | "failed";
  proposedCount: number;
}

/**
 * Run the tailoring chain for the requested domains (default: all three).
 * Synchronous by design (bun's sync SQLite layer); the { runId } response
 * contract is unchanged. Writes PROPOSALS only — never a state row, never a
 * gate_decision (boundary #2).
 */
export async function tailorDdChecklist(
  projectId: string,
  opts: { actor: string; domains?: DdTailorDomain[]; source?: string; /** ADR-0157: an opened comparison target; omitted = the selected/legacy scope. */ targetId?: string | null },
): Promise<TailorResult> {
  const targetId = opts.targetId ?? null;
  const domains = opts.domains?.length ? opts.domains : [...DD_TAILOR_DOMAINS];
  const industry = industryLabelForProject(projectId);
  const executor = getDdTailorExecutor();
  const entity: EntityRef = { entityType: "project", entityId: projectId };

  const before = proposalCount(projectId);
  const activities: ActivitySpec[] = domains.map((domain) => {
    const agentKey = DD_DOMAIN_AGENTS[domain];
    return {
      activityId: `tailor:${domain}`,
      agentKey,
      prompt: `Propose 5-10 industry-tailored DD checklist items for the ${domain} domain — industry: ${industry} (project ${projectId})`,
      execute: async () => {
        const drafts = await executor(domain, { projectId, industry });
        persistDrafts(projectId, domain, agentKey, drafts, targetId);
        const unsourced = drafts.filter((d) => !d.sourceUrl).length;
        return [
          `### [${domain}] ${agentKey} — 산업 맞춤 DD 체크리스트 제안`,
          "",
          `${drafts.length}건 제안 (proposed 상태, 상태 행 없음 — 승인 전까지 진행 불개입).`,
          `Tavily/외부 출처 연결 ${drafts.length - unsourced}건, 출처 없는 제안 ${unsourced}건 — 출처 없는 제안은 그렇게 표시됩니다 (신뢰도 미기재/최저 등급).`,
        ].join("\n");
      },
    };
  });

  const result = await runActivityChain(entity, activities, {
    actor: opts.actor,
    source: opts.source ?? "web",
    // A comparison target's run uses its own stage key so it can never trip
    // the selected scope's already-run guard (ADR-0157).
    stage: targetId ? DD_TAILOR_TARGET_STAGE : DD_TAILOR_STAGE,
  });
  return { processRunId: result.processRunId, status: result.status, proposedCount: proposalCount(projectId) - before };
}

function proposalCount(projectId: string): number {
  return (getDb().query("SELECT COUNT(*) c FROM project_checklist_item_custom WHERE project_id = ?").get(projectId) as { c: number }).c;
}

/**
 * A human-proposed custom item on any of the seven domains (the only path for
 * the four ADR-0148 domains, which have no tailoring templates). Written as
 * 'proposed' with no state row, exactly like a tailoring proposal — it still
 * needs the human review (reviewDdCustomItem) before it counts. For a
 * pre-2026-10-01 project the four newer domains are recorded for reference
 * (allowed and persisted) but stay outside the S9 completion count.
 */
export const DD_CUSTOM_CREATE_ACTION = "dd_custom_item.create";
export const DD_CUSTOM_REVIEW_ACTION = "dd_custom_item.review";
export const MAX_ITEM_LABEL_LEN = 200;
export const MAX_RATIONALE_LEN = 2000;
export const MAX_SOURCE_URL_LEN = 2000;

/** Server-side source_url check: null/blank is allowed; otherwise an http(s) URL of bounded length. */
export function validSourceUrl(v: unknown): boolean {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return true;
  if (typeof v !== "string" || v.trim().length > MAX_SOURCE_URL_LEN) return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The human who proposed a custom item. project_checklist_item_custom has no
 * human-proposer column (only proposed_by_agent), so the proposer is recorded
 * as the actor of the dd_custom_item.create audit entry; null when unknown.
 */
export function ddCustomItemProposer(projectId: string, itemId: string): string | null {
  const row = getDb()
    .query("SELECT actor_user_id FROM audit_log WHERE action = ? AND target = ? ORDER BY created_at, id LIMIT 1")
    .get(DD_CUSTOM_CREATE_ACTION, `${projectId}:${itemId}`) as { actor_user_id: string } | null;
  return row?.actor_user_id ?? null;
}

export function createDdCustomItem(
  projectId: string,
  input: { domain: DdDomain; itemLabel: string; rationale?: string | null; sourceUrl?: string | null; sourceReliability?: "A" | "B" | "C" | null; targetId?: string | null; actor?: string },
): { id: string; domain: DdDomain; status: "proposed" } {
  const id = ulid();
  const db = getDb();
  const now = nowIso();
  db.transaction(() => {
    db.run(
      `INSERT INTO project_checklist_item_custom
         (id, project_id, domain, item_label, rationale, source_url, source_reliability, proposed_by_agent, status, created_at, target_id)
       VALUES (?,?,?,?,?,?,?, NULL, 'proposed', ?, ?)`,
      [id, projectId, input.domain, input.itemLabel.trim(), input.rationale?.trim() || null, input.sourceUrl?.trim() || null, input.sourceReliability ?? null, now, input.targetId ?? null],
    );
    if (input.actor) appendAudit(db, { actor: input.actor, action: DD_CUSTOM_CREATE_ACTION, target: `${projectId}:${id}`, now });
  })();
  return { id, domain: input.domain, status: "proposed" };
}

/** The reviewer is the item's proposer — a second, distinct person must decide. */
export class DdCustomReviewError extends Error {
  constructor(public readonly code: "second_person_required", message: string) {
    super(message);
  }
}

// ── Human review (the boundary-#2 decision) ────────────────────────────────

export type TailorReviewDecision = "approved" | "rejected";

/**
 * Approve or reject one proposed item — the HUMAN decision (boundary #2).
 * On approve: status flip + approved_by/approved_at AND, in the SAME
 * transaction, the project_checklist_item_state row with
 * checklist_id = 'custom:<domain>' (item_id = the custom item's id, status
 * 'pending') — from that moment the item is judged like any other item and
 * the S9 completion check counts it with no special treatment. On reject:
 * status flip only, no state row. Returns the updated item, or null when the
 * item does not exist for this project or is not in 'proposed' status (a
 * decided item is never re-decided).
 */
export function reviewDdCustomItem(
  projectId: string,
  itemId: string,
  decision: TailorReviewDecision,
  userId: string,
): { id: string; domain: DdDomain; status: TailorReviewDecision } | null {
  const db = getDb();
  const item = db
    .query("SELECT id, domain, status, target_id FROM project_checklist_item_custom WHERE id = ? AND project_id = ?")
    .get(itemId, projectId) as { id: string; domain: DdDomain; status: string; target_id: string | null } | undefined;
  if (!item || item.status !== "proposed") return null;
  if (ddCustomItemProposer(projectId, itemId) === userId) {
    throw new DdCustomReviewError("second_person_required", "맞춤 항목을 제안한 사람은 그 항목을 승인/기각할 수 없습니다 — 다른 사람이 검토해야 합니다.");
  }
  const now = nowIso();
  const apply = db.transaction(() => {
    db.run("UPDATE project_checklist_item_custom SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?", [
      decision,
      userId,
      now,
      itemId,
    ]);
    if (decision === "approved") {
      db.run(
        `INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at, target_id)
         VALUES (?,?,?,?, 'pending', ?, ?, ?)`,
        [ulid(), projectId, customChecklistId(item.domain), itemId, userId, now, item.target_id],
      );
    }
    appendAudit(db, { actor: userId, action: DD_CUSTOM_REVIEW_ACTION, target: `${projectId}:${itemId}:${decision}`, now });
  });
  apply();
  return { id: itemId, domain: item.domain, status: decision };
}

// ── Judgment state write (the S9 workspace's ordinary write path) ──────────

export const STATE_STATUSES = ["pending", "pass", "fail", "na", "waived"] as const;
export type ChecklistStateStatus = (typeof STATE_STATUSES)[number];

/**
 * Upsert one judgment-state row for a standard checklist item or an approved
 * custom item (checklist_id 'custom:<domain>'). A 'waived' status requires a
 * waiver_id (0039 discipline, enforced at the API layer — a waiver is created
 * per-project against a key, not per checklist item). Returns null when the
 * (checklist_id, item_id) pair is not an applied item of this project.
 */
export function upsertChecklistState(
  projectId: string,
  checklistId: string,
  itemId: string,
  status: ChecklistStateStatus,
  userId: string,
  opts: { note?: string; evidenceRef?: string; waiverId?: string; /** ADR-0157: resolved scope (see resolveDdScope); NULL = selected/legacy. */ targetId?: string | null } = {},
): { id: string } | null {
  const db = getDb();
  const targetId = opts.targetId ?? null;
  let known = false;
  if (checklistId.startsWith(CUSTOM_CHECKLIST_PREFIX)) {
    known =
      !!db
        .query("SELECT id FROM project_checklist_item_custom WHERE id = ? AND project_id = ? AND status = 'approved' AND target_id IS ?")
        .get(itemId, projectId, targetId);
  } else {
    const items = getChecklistItems(checklistId);
    known = !!items?.some((i) => i.id === itemId);
  }
  if (!known) return null;
  // ADR-0160 addendum (b): an item the workspace scope excludes (N, X with a judged
  // replacement) takes no NEW judgement (409). An item that already carries a row
  // (judged under the previous scope) may be re-judged, so a recorded fail can be
  // cleared by a person — never silently (design §9.3).
  if (targetId === null) {
    const ws = workspaceScopeContext(projectId, db);
    const sc = ws?.items.get(`${checklistId}:${itemId}`);
    if (sc && !sc.judgeable && !ws!.states.has(`${checklistId}:${itemId}`)) {
      throw new DdTargetError(
        409,
        "dd_item_out_of_scope",
        `이 항목(${itemId})은 greenfield 작업 범위에서 ${sc.code === "X" ? "다른 항목으로 대체" : "트랙 규칙상 해당 없음"}입니다 — 새 판정을 기록할 수 없습니다.`,
      );
    }
    // ADR-0162: the same rule for an in-scope brownfield project (workspace items and
    // section-scoped extras). m_and_a / grandfathered projects have no context.
    const bf = ws ? null : brownfieldScopeContext(projectId, db);
    const bsc = bf?.items.get(`${checklistId}:${itemId}`);
    if (bsc && !bsc.judgeable && !bf!.states.has(`${checklistId}:${itemId}`)) {
      throw new DdTargetError(
        409,
        "dd_item_out_of_scope",
        `이 항목(${itemId})은 brownfield 작업 범위에서 ${bsc.code === "X" ? "다른 항목으로 대체" : "거래 형태상 해당 없음"}입니다 — 새 판정을 기록할 수 없습니다.`,
      );
    }
  }
  if (status === "waived" && !opts.waiverId) return null;
  if (opts.waiverId) {
    // A waiver applies to exactly one DD scope (ADR-0157): matched on target_id equality.
    const waiver = db.query("SELECT target_id FROM waiver WHERE id = ? AND project_id = ?").get(opts.waiverId, projectId) as { target_id: string | null } | undefined;
    if (waiver && waiver.target_id !== targetId) {
      throw new DdTargetError(400, "waiver_target_mismatch", "이 waiver는 다른 대상의 DD 범위에 속합니다 — 같은 대상의 waiver만 연결할 수 있습니다.");
    }
  }
  const now = nowIso();
  const existing = db
    .query("SELECT id FROM project_checklist_item_state WHERE project_id = ? AND target_id IS ? AND checklist_id = ? AND item_id = ?")
    .get(projectId, targetId, checklistId, itemId) as { id: string } | undefined;
  if (existing) {
    db.run(
      "UPDATE project_checklist_item_state SET status = ?, note = COALESCE(?, note), evidence_ref = COALESCE(?, evidence_ref), waiver_id = COALESCE(?, waiver_id), assessed_by = ?, assessed_at = ? WHERE id = ?",
      [status, opts.note ?? null, opts.evidenceRef ?? null, opts.waiverId ?? null, userId, now, existing.id],
    );
    return existing;
  }
  const id = ulid();
  db.run(
    `INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, note, evidence_ref, waiver_id, assessed_by, assessed_at, target_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, projectId, checklistId, itemId, status, opts.note ?? null, opts.evidenceRef ?? null, opts.waiverId ?? null, userId, now, targetId],
  );
  return { id };
}

// ── S9 completion predicate (ADR-0099 §5 — state table only) ───────────────

/**
 * The S9 predicate inputs, read from project_checklist_item_state ONLY —
 * this check never reads project_checklist_item_custom. A 'proposed'
 * (unapproved) item has no state row, so it cannot count toward coverage,
 * cannot block, and cannot satisfy anything.
 */
export interface DdCompletionSummary {
  total: number;
  pending: number;
  /**
   * Standard items with no state row, counted only for projects created on/after
   * DD_UNASSESSED_COUNTED_FROM (ADR-0148 option A); always 0 for earlier projects.
   * Separate from `pending` so the pipeline's checklist_approval trigger keeps its meaning.
   */
  unassessed: number;
  /** fail rows on mandatory items without a waiver — the "필수 미충족" count. */
  mandatoryUnmet: number;
  /**
   * ADR-0160 addendum (b): present ONLY for greenfield projects in the new workspace
   * scope (brownfield and grandfathered payloads are unchanged). Y = judgeable items
   * (A + R, C when the site is in scope) of the counted workspace checklists plus the
   * scoped sub-track extras; X/N items never count.
   */
  judged?: number;
  judgeable?: number;
  /** Seven-domain part of `judgeable` (design §5: 52 / 56 / 51, +3 site items). */
  workspace_judgeable?: number;
  /** N + X items of the counted workspace checklists (the "Excluded by track rule" count). */
  excluded?: number;
}

const STANDARD_MANDATORY_CACHE = new Map<string, Set<string>>();

function mandatoryItemIds(checklistId: string): Set<string> | null {
  const cached = STANDARD_MANDATORY_CACHE.get(checklistId);
  if (cached) return cached;
  const items = getChecklistItems(checklistId);
  if (!items) return null; // unknown checklist — not part of the applied floor
  const set = new Set(items.filter((i) => i.mandatory).map((i) => i.id));
  STANDARD_MANDATORY_CACHE.set(checklistId, set);
  return set;
}

/**
 * ADR-0148 option A: from this instant on, a project's standard DD checklist items
 * that have no state row count as `unassessed`, so a never-assessed mandatory item
 * blocks S9 like any other undecided item (reported as `unassessed`). Projects created before it keep the
 * earlier row-only counting (no retroactive blocking). Keyed on md_project.created_at.
 */
export const DD_UNASSESSED_COUNTED_FROM = "2026-10-01T00:00:00.000Z";

/** The four domains added to the S9 workspace by ADR-0148 beyond commercial/technical/legal. */
const DD_NEW_DOMAIN_CHECKLISTS: ReadonlySet<string> = new Set(
  (["financial", "hr", "market", "financing"] as const).map((d) => DD_WORKSPACE_CHECKLISTS[d]),
);
function isGrandfatheredDomain(domain: DdDomain): boolean {
  return DD_NEW_DOMAIN_CHECKLISTS.has(DD_WORKSPACE_CHECKLISTS[domain]!);
}
/**
 * Pre-2026-10-01 projects: the four newer domains are judged and kept for reference
 * (writes allowed) but never enter the completion count, so their gates do not move.
 */
export const DD_NOT_COUNTED_REASON = "Recorded for reference; not counted in S9 completion for projects created before 2026-10-01";

export function isDdDomain(value: string): value is DdDomain {
  return (DD_DOMAINS as readonly string[]).includes(value);
}

/**
 * ADR-0160 addendum (2026-10-12): for a greenfield project in the new workspace
 * scope (opted in, or created after the cut-off) the hr ("인력/조직 계획") domain is
 * counted even when the project was created before 2026-10-01 — a new entity or team
 * is established on that plan. The other three newer domains stay reference-only.
 */
const GF_SCOPE_COUNTED_NEW_DOMAINS: ReadonlySet<DdDomain> = new Set<DdDomain>(["hr"]);

/** True for a state row the completion count ignores: a newer-domain row (standard or custom) of a pre-2026-10-01 project. */
function uncountedRow(checklistId: string, countsNewDomains: boolean, gfInScope = false): boolean {
  if (countsNewDomains) return false;
  const d = checklistId.startsWith(CUSTOM_CHECKLIST_PREFIX)
    ? checklistId.slice(CUSTOM_CHECKLIST_PREFIX.length)
    : (Object.keys(DD_WORKSPACE_CHECKLISTS) as DdDomain[]).find((k) => DD_WORKSPACE_CHECKLISTS[k] === checklistId);
  if (!d || !isDdDomain(d) || !isGrandfatheredDomain(d)) return false;
  return !(gfInScope && GF_SCOPE_COUNTED_NEW_DOMAINS.has(d));
}

function countsUnassessedItems(projectId: string): boolean {
  const row = getDb().query("SELECT created_at FROM md_project WHERE id = ?").get(projectId) as { created_at: string } | undefined;
  return !!row && row.created_at >= DD_UNASSESSED_COUNTED_FROM;
}

/**
 * Wave F-8 (audit B1): sub-track-specific checklists the project must also judge.
 * Brownfield: empty for sub-tracks without one and for projects pinned before
 * WAVE_F_PREDICATE_DATE (grandfathered — no retroactive blocking).
 * Greenfield (ADR-0160): per greenfieldSelection — empty for the null
 * sub-track and for projects grandfathered by GF_SUBTRACK_PREDICATE_DATE.
 */
export function subTrackChecklistIds(projectId: string): string[] {
  const db = getDb();
  const proj = db
    .query("SELECT created_at, source_opportunity_id FROM md_project WHERE id = ?")
    .get(projectId) as { created_at: string | null; source_opportunity_id: string | null } | undefined;
  if (!proj?.source_opportunity_id) return [];
  const pin = db
    // The ADR-0162 opt-in pin never re-dates a project; it attaches extras explicitly below.
    .query("SELECT MIN(pinned_at) AS at FROM project_policy_pin WHERE project_id = ? AND policy_doc_id != ?")
    .get(projectId, BF_WS_POLICY_DOC_ID) as { at: string | null };
  // ADR-0160: greenfield has its own cut-off/opt-in rule (greenfield-subtrack.ts);
  // the brownfield path below is unchanged.
  const gf = greenfieldSelection(projectId, db);
  if (gf) return gf.extra_checklists;
  // ADR-0162 (user decision 2026-10-12): a recorded brownfield opt-in attaches the sub-track extras.
  const bfInfo = brownfieldRouteInfo(projectId, db);
  if (bfInfo?.scope_key && bfInfo.opted_in) return scopedSubTrackDdChecklists(bfInfo.scope_key);
  if ((pin.at ?? proj.created_at ?? "") < WAVE_F_PREDICATE_DATE) return [];
  const route = db
    .query("SELECT track, sub_track FROM route_decision WHERE opportunity_id = ? AND is_current = 1")
    .get(proj.source_opportunity_id) as { track: string; sub_track: string | null } | undefined;
  if (route?.track !== "brownfield" || !route.sub_track) return [];
  // DEC-20261013-03: an in-scope (by date) non-baseline project gets the scoped extras.
  if (bfInfo?.scope_key && bfInfo.by_date) return scopedSubTrackDdChecklists(bfInfo.scope_key);
  return SUB_TRACK_DD_CHECKLISTS[route.sub_track] ?? [];
}

/**
 * ADR-0157: the completion summary of ONE DD scope. The default (no options)
 * reads target_id IS NULL — the selected/legacy scope — so the S9 predicate and
 * the dd gate readiness, which call it with no target, can never be moved by
 * rows recorded on another target. A comparison view passes an opened target id.
 */
export function ddCompletionSummary(projectId: string, opts: { targetId?: string | null } = {}): DdCompletionSummary {
  const targetId = opts.targetId ?? null;
  if (targetId === null) {
    const ws = workspaceScopeContext(projectId, getDb());
    if (ws) return scopedCompletionSummary(projectId, gfScopedInput(ws));
    // ADR-0162: brownfield non-baseline sub-tracks in scope only (m_and_a, null
    // sub-track and grandfathered projects keep the default path below, byte-identical).
    const bf = brownfieldScopeContext(projectId, getDb());
    if (bf) return scopedCompletionSummary(projectId, bfScopedInput(bf));
  }
  const rows = (getDb()
    .query(
      `SELECT checklist_id, item_id, status, waiver_id FROM project_checklist_item_state WHERE project_id = ? AND target_id IS ?`,
    )
    .all(projectId, targetId) as Array<{ checklist_id: string; item_id: string; status: string; waiver_id: string | null }>)
    // Reference-only rows (newer domains of a pre-2026-10-01 project) never enter the count.
    .filter((r) => !uncountedRow(r.checklist_id, countsUnassessedItems(projectId)));
  const extraIds = subTrackChecklistIds(projectId);
  const extraSet = new Set(extraIds);
  let pending = 0;
  let mandatoryUnmet = 0;
  for (const r of rows) {
    if (r.status === "pending") pending += 1;
    if (r.status === "fail" && !r.waiver_id) {
      // Approved custom items were approved INTO the gate-relevant set —
      // approval is the mandatory declaration for them (ADR-0099 §5); for
      // standard items the yaml's mandatory flag decides.
      if (r.checklist_id.startsWith(CUSTOM_CHECKLIST_PREFIX) || mandatoryItemIds(r.checklist_id)?.has(r.item_id)) {
        mandatoryUnmet += 1;
      }
    }
  }
  // Binding items (mandatory, waiver_eligible=false — e.g. bf-01 "all six M&A
  // validators recorded") cannot be satisfied by na/waived: a missing
  // validator is a Kill Criterion, not an exemption.
  for (const checklistId of extraIds) {
    for (const item of scopedChecklistItems(checklistId) ?? []) {
      if (!item.mandatory || item.waiver_eligible) continue;
      const st = rows.find((r) => r.checklist_id === checklistId && r.item_id === item.id);
      if (st && (st.status === "na" || st.status === "waived")) mandatoryUnmet += 1;
    }
  }
  let unassessed = 0;
  if (countsUnassessedItems(projectId) || extraIds.length > 0) {
    const have = new Set(rows.map((r) => `${r.checklist_id}:${r.item_id}`));
    const applicable = [
      ...(countsUnassessedItems(projectId) ? Object.values(DD_WORKSPACE_CHECKLISTS) : []),
      ...extraSet,
    ];
    for (const checklistId of applicable) {
      for (const item of (extraSet.has(checklistId) ? scopedChecklistItems(checklistId) : getChecklistItems(checklistId)) ?? []) {
        if (have.has(`${checklistId}:${item.id}`)) continue;
        unassessed += 1;
      }
    }
  }
  return { total: rows.length, pending, unassessed, mandatoryUnmet };
}

/**
 * Workspace checklists that count for this project (ADR-0148 §6B: the four newer domains
 * only from 2026-10-01; ADR-0160 addendum: hr also for an in-scope greenfield project).
 */
function countedWorkspaceChecklists(projectId: string, gfInScope = false): string[] {
  const all = Object.values(DD_WORKSPACE_CHECKLISTS);
  if (countsUnassessedItems(projectId)) return all;
  const keep = new Set(gfInScope ? [...GF_SCOPE_COUNTED_NEW_DOMAINS].map((d) => DD_WORKSPACE_CHECKLISTS[d]) : []);
  return all.filter((c) => !DD_NEW_DOMAIN_CHECKLISTS.has(c) || keep.has(c));
}

/**
 * ADR-0160 addendum (b) completion for a greenfield project in the workspace scope.
 * Same rules as the default path with the applicable set narrowed: pending and
 * unassessed only on judgeable items; a recorded fail (no waiver) on a mandatory item
 * stays unmet whatever its new code (no silent removal of a negative finding).
 */
interface ScopedInput {
  /** Resolved scope per `<checklist_id>:<item_id>` (judgeable false = N / X). */
  items: Map<string, { judgeable: boolean }>;
  /** Attached extra checklists with their judgeable (scoped) items. */
  extras: Array<[string, ChecklistItemDef[]]>;
  /** Greenfield in the workspace scope: hr counts even for a pre-2026-10-01 project. */
  gfInScope?: boolean;
}
function gfScopedInput(ws: WorkspaceScopeContext): ScopedInput {
  return { items: ws.items, extras: ws.sel.extra_checklists.map((c) => [c, scopedChecklistItems(c) ?? []] as [string, ChecklistItemDef[]]), gfInScope: true };
}
function bfScopedInput(bf: BrownfieldScopeContext): ScopedInput {
  return { items: bf.items, extras: bf.extra_checklists.map((c) => [c, brownfieldExtraItems(bf, c)] as [string, ChecklistItemDef[]]) };
}

function scopedCompletionSummary(projectId: string, ws: ScopedInput): DdCompletionSummary {
  const rows = (getDb()
    .query("SELECT checklist_id, item_id, status, waiver_id FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL")
    .all(projectId) as Array<{ checklist_id: string; item_id: string; status: string; waiver_id: string | null }>)
    .filter((r) => !uncountedRow(r.checklist_id, countsUnassessedItems(projectId), !!ws.gfInScope));
  const counted = countedWorkspaceChecklists(projectId, !!ws.gfInScope);
  const outOfScope = (r: { checklist_id: string; item_id: string }) => ws.items.get(`${r.checklist_id}:${r.item_id}`)?.judgeable === false;
  let pending = 0;
  let mandatoryUnmet = 0;
  for (const r of rows) {
    if (r.status === "pending" && !outOfScope(r)) pending += 1;
    if (r.status === "fail" && !r.waiver_id) {
      if (r.checklist_id.startsWith(CUSTOM_CHECKLIST_PREFIX) || mandatoryItemIds(r.checklist_id)?.has(r.item_id)) mandatoryUnmet += 1;
    }
  }
  for (const [checklistId, extraItems] of ws.extras) {
    for (const item of extraItems) {
      if (!item.mandatory || item.waiver_eligible) continue;
      const st = rows.find((r) => r.checklist_id === checklistId && r.item_id === item.id);
      if (st && (st.status === "na" || st.status === "waived")) mandatoryUnmet += 1;
    }
  }
  // Workspace binding items (fin-09) are never N/X (overlay validator) and keep the default rule.
  const byKey = new Map(rows.map((r) => [`${r.checklist_id}:${r.item_id}`, r]));
  const countUnassessed = countsUnassessedItems(projectId);
  let unassessed = 0;
  let judged = 0;
  let workspaceJudgeable = 0;
  let excluded = 0;
  for (const checklistId of counted) {
    for (const item of getChecklistItems(checklistId) ?? []) {
      const k = `${checklistId}:${item.id}`;
      if (ws.items.get(k)?.judgeable === false) {
        excluded += 1;
        continue;
      }
      workspaceJudgeable += 1;
      const st = byKey.get(k);
      if (st && st.status !== "pending") judged += 1;
      if (!st && countUnassessed) unassessed += 1;
    }
  }
  let extraJudgeable = 0;
  for (const [checklistId, extraItems] of ws.extras) {
    for (const item of extraItems) {
      extraJudgeable += 1;
      const st = byKey.get(`${checklistId}:${item.id}`);
      if (st && st.status !== "pending") judged += 1;
      if (!st) unassessed += 1;
    }
  }
  return {
    total: rows.length,
    pending,
    unassessed,
    mandatoryUnmet,
    judged,
    judgeable: workspaceJudgeable + extraJudgeable,
    workspace_judgeable: workspaceJudgeable,
    excluded,
  };
}

/** The workspace-scope block of the dd GET / greenfield-scope GET (greenfield in scope only). */
export interface WorkspaceScopeView {
  active: true;
  overlay_doc_id: string;
  overlay_version: string;
  scope_key: WorkspaceScopeKey;
  /** Per item: code, reading / reason, replacement pointers, step tags. Key `<checklist_id>:<item_id>`. */
  items: Record<string, WorkspaceItemScope>;
  /** Interim greenfield tab labels from the overlay (person chooses the final ones). */
  tab_labels: Record<string, { en: string; ko: string }>;
  step_tabs: Record<string, StepTag[]>;
  plan_readiness: PlanReadinessRow[];
  previous_scope: PreviousScopeEntry[];
  counts: { judged: number; judgeable: number; workspace_judgeable: number; excluded: number; mandatory_unmet: number };
}

/** Workspace scope view for a greenfield project; `null` when the scope is not active (grandfathered or no overlay). */
export function workspaceScopeView(projectId: string, sel?: GreenfieldSelection | null): WorkspaceScopeView | null {
  const db = getDb();
  const ws = workspaceScopeContext(projectId, db, sel);
  if (!ws) return null;
  const ov = workspaceOverlay()!;
  const c = scopedCompletionSummary(projectId, gfScopedInput(ws));
  return {
    active: true,
    overlay_doc_id: ov.governance_doc_id,
    overlay_version: ws.overlay_version,
    scope_key: ws.key,
    items: Object.fromEntries(ws.items),
    tab_labels: ov.tab_labels,
    step_tabs: stepTabMap(ws.sel, ws.states),
    plan_readiness: planReadinessRows(projectId, ws.sel, db),
    previous_scope: previousScopeEntries(ws.items, ws.states),
    counts: { judged: c.judged!, judgeable: c.judgeable!, workspace_judgeable: c.workspace_judgeable!, excluded: c.excluded!, mandatory_unmet: c.mandatoryUnmet },
  };
}

export interface WorkspaceOptInPreview {
  project_id: string;
  eligible: boolean;
  /** Why the opt-in is not offered (already in scope, brownfield, no overlay). */
  reason: string | null;
  overlay_version: string | null;
  before: { judged: number; judgeable: number; pending: number; unassessed: number; mandatory_unmet: number };
  after: { judged: number; judgeable: number; workspace_judgeable: number; excluded: number; pending: number; unassessed: number; mandatory_unmet: number };
  /** Existing judgements that move to "Judged under previous scope" (kept, never deleted). */
  moves_to_previous_scope: PreviousScopeEntry[];
  /** Recorded fails (no waiver) on items leaving scope — they stay unmet until a person re-judges them. */
  fails_stay_unmet: PreviousScopeEntry[];
  /** True when the opt-in also records the ADR-0160 sub-track pin (one human act, two pins). */
  records_subtrack_pin: boolean;
  /**
   * Greenfield only: newer-domain checklists that enter the count with the opt-in
   * (hr for a pre-2026-10-01 project) — judgeable items and those already judged.
   * Empty when nothing new becomes countable.
   */
  newly_counted?: Array<{ checklist_id: string; judgeable: number; judged: number; judged_item_ids: string[] }>;
  /** ADR-0162 (brownfield preview only): extra checklists the opt-in attaches that are not attached today, with judgeable (scoped) counts. */
  extras_attached_by_opt_in?: Array<{ checklist_id: string; judgeable: number; excluded: number }>;
}

/** Judged / applicable count of the current (pre-opt-in) view, read the same way the S9 tabs read it. */
function currentViewCounts(projectId: string): { judged: number; judgeable: number } {
  const db = getDb();
  const rows = db
    .query("SELECT checklist_id, item_id, status FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL")
    .all(projectId) as Array<{ checklist_id: string; item_id: string; status: string }>;
  const byKey = new Map(rows.map((r) => [`${r.checklist_id}:${r.item_id}`, r]));
  let judged = 0;
  let judgeable = 0;
  const lists: Array<[string, ChecklistItemDef[]]> = [
    ...countedWorkspaceChecklists(projectId).map((c) => [c, getChecklistItems(c) ?? []] as [string, ChecklistItemDef[]]),
    ...subTrackChecklistIds(projectId).map((c) => [c, scopedChecklistItems(c) ?? []] as [string, ChecklistItemDef[]]),
  ];
  for (const [c, items] of lists) {
    for (const i of items) {
      judgeable += 1;
      const st = byKey.get(`${c}:${i.id}`);
      if (st && st.status !== "pending") judged += 1;
    }
  }
  return { judged, judgeable };
}

/** hr (and any other GF_SCOPE_COUNTED_NEW_DOMAINS) items that become countable with the scope. */
function newlyCountedChecklists(projectId: string, hyp: WorkspaceScopeContext, active: boolean) {
  if (active) return [];
  const before = new Set(countedWorkspaceChecklists(projectId));
  const out: NonNullable<WorkspaceOptInPreview["newly_counted"]> = [];
  for (const c of countedWorkspaceChecklists(projectId, true)) {
    if (before.has(c)) continue;
    let judgeable = 0;
    const judgedIds: string[] = [];
    for (const i of getChecklistItems(c) ?? []) {
      if (hyp.items.get(`${c}:${i.id}`)?.judgeable === false) continue;
      judgeable += 1;
      const st = hyp.states.get(`${c}:${i.id}`);
      if (st && st.status !== "pending") judgedIds.push(i.id);
    }
    out.push({ checklist_id: c, judgeable, judged: judgedIds.length, judged_item_ids: judgedIds });
  }
  return out;
}

/** Read-only opt-in preview (design §9.3): how X / Y changes; nothing is written. */
export function workspaceOptInPreview(projectId: string): WorkspaceOptInPreview | null {
  const db = getDb();
  const sel = greenfieldSelection(projectId, db);
  if (!sel) return null;
  const current = ddCompletionSummary(projectId);
  const cur = currentViewCounts(projectId);
  const active = workspaceScopeContext(projectId, db, sel);
  const hyp = active ?? hypotheticalWorkspaceScope(projectId, db);
  const before = { judged: current.judged ?? cur.judged, judgeable: current.judgeable ?? cur.judgeable, pending: current.pending, unassessed: current.unassessed, mandatory_unmet: current.mandatoryUnmet };
  if (!hyp) {
    return {
      project_id: projectId, eligible: false, reason: "작업 범위 오버레이를 읽을 수 없습니다.", overlay_version: null,
      before, after: { ...before, workspace_judgeable: 0, excluded: 0 }, moves_to_previous_scope: [], fails_stay_unmet: [], records_subtrack_pin: false,
    };
  }
  const after = scopedCompletionSummary(projectId, gfScopedInput(hyp));
  const moved = previousScopeEntries(hyp.items, hyp.states);
  return {
    project_id: projectId,
    eligible: !active,
    reason: active ? "이미 새 작업 범위가 적용된 프로젝트입니다." : null,
    overlay_version: hyp.overlay_version,
    before,
    after: {
      judged: after.judged!, judgeable: after.judgeable!, workspace_judgeable: after.workspace_judgeable!, excluded: after.excluded!,
      pending: after.pending, unassessed: after.unassessed, mandatory_unmet: after.mandatoryUnmet,
    },
    moves_to_previous_scope: moved,
    fails_stay_unmet: moved.filter((m) => m.stays_unmet),
    records_subtrack_pin: !active && hyp.sel.selection_active && !sel.selection_active,
    newly_counted: newlyCountedChecklists(projectId, hyp, !!active),
  };
}

// ── ADR-0162 brownfield workspace scope (view + opt-in preview) ───────────

/** The brownfield workspace-scope block of the dd GET (non-baseline sub-tracks in scope only). */
export interface BrownfieldWorkspaceScopeView {
  active: true;
  overlay_doc_id: string;
  overlay_version: string;
  scope_key: BrownfieldScopeKey;
  opted_in: boolean;
  /** Attached extra checklists (attach rule unchanged); their excluded sections carry code N. */
  extra_checklists: string[];
  /** Per item (workspace + attached extras): code, reading / reason, replacement pointers. Key `<checklist_id>:<item_id>`. */
  items: Record<string, WorkspaceItemScope>;
  previous_scope: PreviousScopeEntry[];
  counts: { judged: number; judgeable: number; workspace_judgeable: number; excluded: number; extras_excluded: number; mandatory_unmet: number };
}

function brownfieldViewOf(projectId: string, ctx: BrownfieldScopeContext): BrownfieldWorkspaceScopeView {
  const c = scopedCompletionSummary(projectId, bfScopedInput(ctx));
  let extrasExcluded = 0;
  for (const sc of ctx.items.values()) if (!sc.judgeable && ctx.extra_checklists.includes(sc.checklist_id)) extrasExcluded += 1;
  return {
    active: true,
    overlay_doc_id: BF_WS_POLICY_DOC_ID,
    overlay_version: ctx.overlay_version,
    scope_key: ctx.key,
    opted_in: ctx.opted_in,
    extra_checklists: ctx.extra_checklists,
    items: Object.fromEntries(ctx.items),
    previous_scope: brownfieldPreviousScope(ctx),
    counts: {
      judged: c.judged!, judgeable: c.judgeable!, workspace_judgeable: c.workspace_judgeable!, excluded: c.excluded!,
      extras_excluded: extrasExcluded, mandatory_unmet: c.mandatoryUnmet,
    },
  };
}

/** Brownfield workspace scope view; null for m_and_a, null sub-track, grandfathered projects and greenfield. */
export function brownfieldWorkspaceScopeView(projectId: string): BrownfieldWorkspaceScopeView | null {
  const ctx = brownfieldScopeContext(projectId, getDb());
  return ctx ? brownfieldViewOf(projectId, ctx) : null;
}

/**
 * Read-only brownfield opt-in preview (design §9.3): before / after counts and
 * the judgements that would move to "Judged under previous scope". null when
 * the project is not on the brownfield route. Nothing is written.
 */
export function brownfieldOptInPreview(projectId: string): WorkspaceOptInPreview | null {
  const db = getDb();
  const info = brownfieldRouteInfo(projectId, db);
  if (!info) return null;
  const current = ddCompletionSummary(projectId);
  const cur = currentViewCounts(projectId);
  const before = { judged: current.judged ?? cur.judged, judgeable: current.judgeable ?? cur.judgeable, pending: current.pending, unassessed: current.unassessed, mandatory_unmet: current.mandatoryUnmet };
  const active = brownfieldScopeContext(projectId, db);
  const hyp = active ?? hypotheticalBrownfieldScope(projectId, db);
  if (!hyp) {
    return {
      project_id: projectId,
      eligible: false,
      reason: info.scope_key
        ? "작업 범위 오버레이를 읽을 수 없습니다."
        : "이 세부 유형(인수합병 기준 열 또는 세부 유형 없음)은 작업 범위가 바뀌지 않습니다.",
      overlay_version: null,
      before, after: { ...before, workspace_judgeable: 0, excluded: 0 }, moves_to_previous_scope: [], fails_stay_unmet: [], records_subtrack_pin: false,
    };
  }
  const after = scopedCompletionSummary(projectId, bfScopedInput(hyp));
  const moved = brownfieldPreviousScope(hyp);
  return {
    project_id: projectId,
    eligible: !active,
    reason: active ? "이미 새 작업 범위가 적용된 프로젝트입니다." : null,
    overlay_version: hyp.overlay_version,
    before,
    after: {
      judged: after.judged!, judgeable: after.judgeable!, workspace_judgeable: after.workspace_judgeable!, excluded: after.excluded!,
      pending: after.pending, unassessed: after.unassessed, mandatory_unmet: after.mandatoryUnmet,
    },
    moves_to_previous_scope: moved,
    fails_stay_unmet: moved.filter((m) => m.stays_unmet),
    records_subtrack_pin: false,
    extras_attached_by_opt_in: hyp.extra_checklists
      .filter((c) => !subTrackChecklistIds(projectId).includes(c))
      .map((c) => {
        const judgeable = brownfieldExtraItems(hyp, c).length;
        return { checklist_id: c, judgeable, excluded: (getChecklistItems(c)?.length ?? 0) - judgeable };
      }),
  };
}

// ── Aggregate read surface (GET /api/projects/[id]/dd) ─────────────────────

export interface DdWorkspaceView {
  domains: Array<{
    /** DdDomain for the shared tabs; the checklist id for Wave F-8 sub-track tabs. */
    domain: string;
    checklistId: string;
    title: string;
    /** `scope` is present only for greenfield projects in the workspace scope (ADR-0160 addendum b). */
    items: Array<ChecklistItemDef & { state: DdItemState | null; scope?: WorkspaceItemScope }>;
    custom: CustomItemRow[];
    /**
     * ADR-0148 §6B: false for the four newer domains of a project created before
     * DD_UNASSESSED_COUNTED_FROM — judgeable and persisted, but not in the completion count.
     * Absent on sub-track extra tabs (always counted).
     */
    counted?: boolean;
    counted_reason?: string;
  }>;
  findings: FindingRow[];
  completion: DdCompletionSummary;
  /** ADR-0157: the scope this payload describes — null = the selected/legacy scope that the gate judges. */
  scope_target_id: string | null;
  /** ADR-0160: present only for greenfield projects; `workspace_scope` only when the addendum (b) scope is active. */
  greenfield_scope?: GreenfieldSelection & { workspace_scope?: WorkspaceScopeView };
  /** ADR-0162: present only for brownfield non-baseline sub-tracks in the new workspace scope. */
  brownfield_scope?: { sub_track: string; workspace_scope: BrownfieldWorkspaceScopeView };
  /** The target the dd gate judges (the S8 selection), if any. */
  selected_target_id: string | null;
  /** One entry per shortlisted target (brownfield only; empty otherwise). */
  targets: DdTargetSummary[];
}

export interface DdItemState {
  status: ChecklistStateStatus;
  note: string | null;
  evidence_ref: string | null;
  waiver_id: string | null;
  assessed_by: string | null;
  assessed_at: string | null;
}

export interface CustomItemRow {
  id: string;
  domain: DdDomain;
  item_label: string;
  rationale: string | null;
  source_url: string | null;
  source_reliability: "A" | "B" | "C" | null;
  proposed_by_agent: string | null;
  status: "proposed" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  /** Human proposer (display name, else account id) from the dd_custom_item.create audit entry; null for agent or unknown proposals. */
  proposed_by_user: string | null;
  /** True when the calling user proposed this item (they cannot review it). */
  is_proposer: boolean;
  state: DdItemState | null;
}

export interface FindingRow {
  id: string;
  category: string;
  description: string;
  value_impact: number | null;
  assumption_key: string | null;
  evidence_ref: string | null;
  created_at: string;
}

/** Assemble the whole S9 surface: standard items + live state, custom items with provenance, findings, completion. */
export function listDdWorkspace(projectId: string, opts: { targetId?: string | null; viewerId?: string | null } = {}): DdWorkspaceView {
  const db = getDb();
  const targetId = opts.targetId ?? null;
  const states = new Map<string, DdItemState>();
  for (const s of db
    .query("SELECT checklist_id, item_id, status, note, evidence_ref, waiver_id, assessed_by, assessed_at FROM project_checklist_item_state WHERE project_id = ? AND target_id IS ?")
    .all(projectId, targetId) as Array<{ checklist_id: string; item_id: string; status: ChecklistStateStatus; note: string | null; evidence_ref: string | null; waiver_id: string | null; assessed_by: string | null; assessed_at: string | null }>) {
    states.set(`${s.checklist_id}:${s.item_id}`, { status: s.status, note: s.note, evidence_ref: s.evidence_ref, waiver_id: s.waiver_id, assessed_by: s.assessed_by, assessed_at: s.assessed_at });
  }

  const customByDomain = new Map<DdDomain, CustomItemRow[]>();
  for (const c of db
    .query(
      `SELECT id, domain, item_label, rationale, source_url, source_reliability, proposed_by_agent, status, approved_by, approved_at, created_at
       FROM project_checklist_item_custom WHERE project_id = ? AND target_id IS ? ORDER BY created_at, id`,
    )
    .all(projectId, targetId) as Array<Omit<CustomItemRow, "state" | "proposed_by_user" | "is_proposer">>) {
    const proposer = c.proposed_by_agent === null ? ddCustomItemProposer(projectId, c.id) : null;
    const human = proposer !== null && !AGENT_KEYS.has(proposer) ? proposer : null;
    const name = human
      ? ((db.query("SELECT display_name FROM app_user WHERE user_id = ?").get(human) as { display_name: string | null } | null)?.display_name?.trim() || human)
      : null;
    const row: CustomItemRow = {
      ...c,
      proposed_by_user: name,
      is_proposer: human !== null && !!opts.viewerId && opts.viewerId === human,
      state: states.get(`${customChecklistId(c.domain)}:${c.id}`) ?? null,
    };
    const list = customByDomain.get(c.domain) ?? [];
    list.push(row);
    customByDomain.set(c.domain, list);
  }

  const findings = db
    .query(
      `SELECT id, category, description, value_impact, assumption_key, evidence_ref, created_at
       FROM dd_finding WHERE project_id = ? AND target_id IS ? ORDER BY created_at DESC, id`,
    )
    .all(projectId, targetId) as unknown as FindingRow[];

  const domainLabels: Record<DdDomain, string> = {
    commercial: DD_DOMAIN_LABEL.commercial!, technical: DD_DOMAIN_LABEL.technical!, legal: DD_DOMAIN_LABEL.legal!,
    // All seven domains carry the Korean DD_DOMAIN_LABEL titles (UI tabs, payload and reports agree).
    financial: DD_DOMAIN_LABEL.financial!, hr: DD_DOMAIN_LABEL.hr!, market: DD_DOMAIN_LABEL.market!, financing: DD_DOMAIN_LABEL.financing!,
  };
  const countsNewDomains = countsUnassessedItems(projectId);
  const gfScope = greenfieldSelection(projectId, db);
  // ADR-0160 addendum (b): the gate scope only (target_id NULL); comparison targets are brownfield.
  const wsView = gfScope && targetId === null ? workspaceScopeView(projectId, gfScope) : null;
  // ADR-0162: brownfield gate scope only; comparison targets keep today's payload.
  const bfCtx = !gfScope && targetId === null ? brownfieldScopeContext(projectId, db) : null;
  const bfView = bfCtx ? brownfieldViewOf(projectId, bfCtx) : null;
  const itemScopes = wsView?.items ?? bfView?.items;
  const domains = DD_DOMAINS.map((domain) => {
    const checklistId = DD_WORKSPACE_CHECKLISTS[domain];
    const items = (getChecklistItems(checklistId) ?? []).map((i) => {
      const scope = itemScopes?.[`${checklistId}:${i.id}`];
      return { ...i, state: states.get(`${checklistId}:${i.id}`) ?? null, ...(scope ? { scope } : {}) };
    });
    const counted = !(isGrandfatheredDomain(domain) && !countsNewDomains) || (!!wsView && GF_SCOPE_COUNTED_NEW_DOMAINS.has(domain));
    return {
      domain, checklistId, title: domainLabels[domain], items, custom: customByDomain.get(domain) ?? [],
      counted,
      ...(counted ? {} : { counted_reason: DD_NOT_COUNTED_REASON }),
    };
  });

  // Wave F-8 (audit B1): sub-track-specific checklists appended as extra tabs.
  // INTERIM-WORDING: Korean tab titles (no glossary term exists for partnership / pre-signing).
  const SUB_TRACK_TITLES: Record<string, string> = {
    "chk-brownfield-feasibility-checklist": "M&A 6대 검증(브라운필드 타당성)", // INTERIM-WORDING
    "chk-ma-special-topics-checklist": "M&A 특수 주제",
    "chk-partnership-checklist": "파트너십 점검", // INTERIM-WORDING
    "chk-deal-shape-presigning-checklist": "체결 전 딜 구조 점검", // INTERIM-WORDING
    "chk-rbd-technology-checklist": "R&BD 기술",
    "chk-entity-formation-checklist": "법인 설립 준비 (계획 검증)",
  };
  const extra = subTrackChecklistIds(projectId).map((checklistId) => ({
    domain: checklistId,
    checklistId,
    title: SUB_TRACK_TITLES[checklistId] ?? checklistId,
    // Brownfield in scope: every item listed with its scope (excluded sections carry N + reason).
    items: bfView
      ? (getChecklistItems(checklistId) ?? []).map((i) => {
          const scope = bfView.items[`${checklistId}:${i.id}`];
          return { ...i, state: states.get(`${checklistId}:${i.id}`) ?? null, ...(scope ? { scope } : {}) };
        })
      : (scopedChecklistItems(checklistId) ?? []).map((i) => ({ ...i, state: states.get(`${checklistId}:${i.id}`) ?? null })),
    custom: [] as CustomItemRow[],
  }));
  return {
    domains: [...domains, ...extra],
    findings,
    completion: ddCompletionSummary(projectId, { targetId }),
    scope_target_id: targetId,
    selected_target_id: selectedTargetId(projectId, db),
    targets: listDdTargetSummaries(projectId),
    // ADR-0160: greenfield only (brownfield payload unchanged) — sub-track,
    // site scope, excluded steps and warnings for the excluded-by-rule panel.
    ...(gfScope ? { greenfield_scope: { ...gfScope, ...(wsView ? { workspace_scope: wsView } : {}) } } : {}),
    ...(bfCtx && bfView ? { brownfield_scope: { sub_track: bfCtx.sub_track, workspace_scope: bfView } } : {}),
  };
}

/**
 * ADR-0157: one summary row per shortlisted target — the comparison-table
 * source. The selected target's row is the gate scope (target_id IS NULL);
 * every other row is comparison evidence, never a verdict.
 */
export function listDdTargetSummaries(projectId: string): DdTargetSummary[] {
  const db = getDb();
  const project = db.query("SELECT track, source_opportunity_id FROM md_project WHERE id = ?").get(projectId) as
    | { track: string | null; source_opportunity_id: string | null }
    | undefined;
  if (!project || project.track !== "brownfield") return [];
  const selected = selectedTargetId(projectId, db);
  const targets = db
    .query(
      `SELECT bt.id, bt.company_name FROM brownfield_target bt
       WHERE bt.opportunity_id = ? AND bt.status = 'shortlisted'
       ORDER BY bt.rank IS NULL, bt.rank, bt.created_at`,
    )
    .all(project.source_opportunity_id ?? "") as Array<{ id: string; company_name: string }>;
  const opens = new Map(
    (db.query("SELECT target_id, opened_at, opened_by, rationale FROM dd_target_open WHERE project_id = ?").all(projectId) as Array<{ target_id: string; opened_at: string; opened_by: string; rationale: string }>).map(
      (o) => [o.target_id, o],
    ),
  );
  const out: DdTargetSummary[] = [];
  for (const t of targets) {
    const isSelected = t.id === selected;
    const open = opens.get(t.id);
    const opened = isSelected || !!open;
    const scope = isSelected ? null : t.id;
    const c = opened ? ddCompletionSummary(projectId, { targetId: scope }) : { total: 0, pending: 0, unassessed: 0, mandatoryUnmet: 0 };
    const f = opened
      ? (db
          .query("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN value_impact IS NOT NULL THEN 1 ELSE 0 END), 0) AS v FROM dd_finding WHERE project_id = ? AND target_id IS ?")
          .get(projectId, scope) as { n: number; v: number })
      : { n: 0, v: 0 };
    out.push({
      target_id: t.id,
      name: t.company_name,
      is_selected: isSelected,
      opened,
      opened_at: open?.opened_at ?? null,
      opened_by: open?.opened_by ?? null,
      rationale: open?.rationale ?? null,
      total: c.total,
      unassessed: c.unassessed,
      pending: c.pending,
      mandatory_unmet: c.mandatoryUnmet,
      findings: f.n,
      findings_with_value_impact: f.v,
    });
  }
  return out;
}
