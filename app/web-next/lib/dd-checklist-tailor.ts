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
import { runActivityChain, type ActivitySpec, type EntityRef } from "./agent-orchestrator.ts";
import { DD_WORKSPACE_CHECKLISTS, getChecklistItems, type ChecklistItemDef } from "./library.ts";

// ADR-0104 — DD workspace expanded to 7 domains (financial/hr/market/financing
// added alongside commercial/technical/legal).
export const DD_DOMAINS = [
  "commercial", "technical", "legal",
] as const;
export type DdDomain = (typeof DD_DOMAINS)[number];

/** ADR-0099 §2 — per-domain S9 activity owner. */
export const DD_DOMAIN_AGENTS: Record<DdDomain, string> = {
  commercial: "commercial-dd-agent",
  technical: "technical-dd-agent",
  legal: "legal-counsel",
};

export const DD_TAILOR_STAGE = "s9_dd_checklist_tailoring";
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

const TEMPLATES: Record<DdDomain, Array<{ label: string; rationale: string }>> = {
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

function renderTemplates(domain: DdDomain, industry: string) {
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
export type DdTailorExecutor = (domain: DdDomain, ctx: { projectId: string; industry: string }) => Promise<TailorItemDraft[]>;

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

function persistDrafts(projectId: string, domain: DdDomain, agentKey: string, drafts: TailorItemDraft[]): void {
  const db = getDb();
  const now = nowIso();
  for (const d of drafts) {
    if (!d.itemLabel?.trim()) continue; // never persist an empty proposal
    db.run(
      `INSERT INTO project_checklist_item_custom
         (id, project_id, domain, item_label, rationale, source_url, source_reliability, proposed_by_agent, status, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'proposed', ?)`,
      [ulid(), projectId, domain, d.itemLabel.trim(), d.rationale?.trim() ?? null, d.sourceUrl ?? null, d.sourceReliability ?? null, agentKey, now],
    );
  }
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
  opts: { actor: string; domains?: DdDomain[]; source?: string },
): Promise<TailorResult> {
  const domains = opts.domains?.length ? opts.domains : [...DD_DOMAINS];
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
        persistDrafts(projectId, domain, agentKey, drafts);
        const unsourced = drafts.filter((d) => !d.sourceUrl).length;
        return [
          `### [${domain}] ${agentKey} — 산업 맞춤 DD 체크리스트 제안`,
          "",
          `${drafts.length}건 제안 (proposed 상태, 상태 행 없음 — 승인 전까지 게이트 불개입).`,
          `출처 없는 제안 ${unsourced}건 — 출처 없는 제안은 그렇게 표시됩니다 (신뢰도 미기재/최저 등급).`,
        ].join("\n");
      },
    };
  });

  const result = await runActivityChain(entity, activities, {
    actor: opts.actor,
    source: opts.source ?? "web",
    stage: DD_TAILOR_STAGE,
  });
  return { processRunId: result.processRunId, status: result.status, proposedCount: proposalCount(projectId) - before };
}

function proposalCount(projectId: string): number {
  return (getDb().query("SELECT COUNT(*) c FROM project_checklist_item_custom WHERE project_id = ?").get(projectId) as { c: number }).c;
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
    .query("SELECT id, domain, status FROM project_checklist_item_custom WHERE id = ? AND project_id = ?")
    .get(itemId, projectId) as { id: string; domain: DdDomain; status: string } | undefined;
  if (!item || item.status !== "proposed") return null;
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
        `INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at)
         VALUES (?,?,?,?, 'pending', ?, ?)`,
        [ulid(), projectId, customChecklistId(item.domain), itemId, userId, now],
      );
    }
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
  opts: { note?: string; evidenceRef?: string; waiverId?: string } = {},
): { id: string } | null {
  const db = getDb();
  let known = false;
  if (checklistId.startsWith(CUSTOM_CHECKLIST_PREFIX)) {
    known =
      !!db
        .query("SELECT id FROM project_checklist_item_custom WHERE id = ? AND project_id = ? AND status = 'approved'")
        .get(itemId, projectId);
  } else {
    const items = getChecklistItems(checklistId);
    known = !!items?.some((i) => i.id === itemId);
  }
  if (!known) return null;
  if (status === "waived" && !opts.waiverId) return null;
  const now = nowIso();
  const existing = db
    .query("SELECT id FROM project_checklist_item_state WHERE project_id = ? AND checklist_id = ? AND item_id = ?")
    .get(projectId, checklistId, itemId) as { id: string } | undefined;
  if (existing) {
    db.run(
      "UPDATE project_checklist_item_state SET status = ?, note = COALESCE(?, note), evidence_ref = COALESCE(?, evidence_ref), waiver_id = COALESCE(?, waiver_id), assessed_by = ?, assessed_at = ? WHERE id = ?",
      [status, opts.note ?? null, opts.evidenceRef ?? null, opts.waiverId ?? null, userId, now, existing.id],
    );
    return existing;
  }
  const id = ulid();
  db.run(
    `INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, note, evidence_ref, waiver_id, assessed_by, assessed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, projectId, checklistId, itemId, status, opts.note ?? null, opts.evidenceRef ?? null, opts.waiverId ?? null, userId, now],
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
  /** fail rows on mandatory items without a waiver — the "필수 미충족" count. */
  mandatoryUnmet: number;
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

export function ddCompletionSummary(projectId: string): DdCompletionSummary {
  const rows = getDb()
    .query(
      `SELECT checklist_id, item_id, status, waiver_id FROM project_checklist_item_state WHERE project_id = ?`,
    )
    .all(projectId) as Array<{ checklist_id: string; item_id: string; status: string; waiver_id: string | null }>;
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
  return { total: rows.length, pending, mandatoryUnmet };
}

// ── Aggregate read surface (GET /api/projects/[id]/dd) ─────────────────────

export interface DdWorkspaceView {
  domains: Array<{
    domain: DdDomain;
    checklistId: string;
    title: string;
    items: Array<ChecklistItemDef & { state: { status: ChecklistStateStatus; note: string | null; evidence_ref: string | null; waiver_id: string | null } | null }>;
    custom: CustomItemRow[];
  }>;
  findings: FindingRow[];
  completion: DdCompletionSummary;
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
  state: { status: ChecklistStateStatus; note: string | null; evidence_ref: string | null; waiver_id: string | null } | null;
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
export function listDdWorkspace(projectId: string): DdWorkspaceView {
  const db = getDb();
  const states = new Map<string, { status: ChecklistStateStatus; note: string | null; evidence_ref: string | null; waiver_id: string | null }>();
  for (const s of db
    .query("SELECT checklist_id, item_id, status, note, evidence_ref, waiver_id FROM project_checklist_item_state WHERE project_id = ?")
    .all(projectId) as Array<{ checklist_id: string; item_id: string; status: ChecklistStateStatus; note: string | null; evidence_ref: string | null; waiver_id: string | null }>) {
    states.set(`${s.checklist_id}:${s.item_id}`, { status: s.status, note: s.note, evidence_ref: s.evidence_ref, waiver_id: s.waiver_id });
  }

  const customByDomain = new Map<DdDomain, CustomItemRow[]>();
  for (const c of db
    .query(
      `SELECT id, domain, item_label, rationale, source_url, source_reliability, proposed_by_agent, status, approved_by, approved_at, created_at
       FROM project_checklist_item_custom WHERE project_id = ? ORDER BY created_at, id`,
    )
    .all(projectId) as Array<Omit<CustomItemRow, "state">>) {
    const row: CustomItemRow = { ...c, state: states.get(`${customChecklistId(c.domain)}:${c.id}`) ?? null };
    const list = customByDomain.get(c.domain) ?? [];
    list.push(row);
    customByDomain.set(c.domain, list);
  }

  const findings = db
    .query(
      `SELECT id, category, description, value_impact, assumption_key, evidence_ref, created_at
       FROM dd_finding WHERE project_id = ? ORDER BY created_at DESC, id`,
    )
    .all(projectId) as unknown as FindingRow[];

  const domainLabels: Record<DdDomain, string> = { commercial: "Commercial DD", technical: "Technical DD", legal: "Legal DD" };
  const domains = DD_DOMAINS.map((domain) => {
    const checklistId = DD_WORKSPACE_CHECKLISTS[domain];
    const items = (getChecklistItems(checklistId) ?? []).map((i) => ({
      ...i,
      state: states.get(`${checklistId}:${i.id}`) ?? null,
    }));
    return { domain, checklistId, title: domainLabels[domain], items, custom: customByDomain.get(domain) ?? [] };
  });

  return { domains, findings, completion: ddCompletionSummary(projectId) };
}
