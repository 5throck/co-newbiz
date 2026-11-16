// brownfield-eval-bulk.ts — S6 bulk AI evaluation run engine (ADR-0199, spec 2026-11-16-s6-bulk-ai-eval-versioning
// §5 run engine, §6 DART collection / budget / resume, §7 failure semantics, §9 MNPI).
//
// One run = one attribution unit. Candidates are processed ONE AT A TIME in `seq` order; per candidate the steps are
//   disclosure list -> financial facts (incremental) -> financial draft -> business-report body -> technical draft.
// Every step checkpoints on the run item, so resume restarts at the recorded step and the cache makes the restart
// cheaper than the original.
//
// Hard rules enforced here:
//   - a draft is a PROPOSAL stored as an immutable version; nothing here writes brownfield_target_eval_state
//     (only the human-only confirm route does, brownfield-eval-confirm.ts);
//   - a version is inserted only when a category step completes (replace-on-success); unchanged inputs write no
//     version and make no LLM call (commitCategoryDraft);
//   - the engine never resumes itself: a paused/interrupted run restarts only through the resume route, called by a
//     person (or an agent under a person's delegation), so every version has a real attributable caller;
//   - an unconfigured LLM skips the technical step instead of writing an all-unverified version;
//   - web search runs only when the run's web_evidence flag is set, and its queries carry only the company name and
//     the criterion label (no opportunity name, our company name or deal terms).
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../../db/lib/access-control.ts";
import {
  commitCategoryDraft,
  finishRun,
  getRun,
  listRunItems,
  nextResumableItem,
  pauseRun,
  touchRunHeartbeat,
  updateRunItem,
  computeDraftInputHash,
  type CategoryOutcome,
  type DraftRunItemRow,
  type DraftRunRow,
  type DraftVersionContent,
  type EvalDraftCategory,
  type EvalDraftPayload,
  type EvidenceGrade,
  type ReasonDetailCode,
  EvalDraftError,
} from "../../../db/repositories/brownfield-eval-draft.repository.ts";
import {
  disclosureQueryEnd,
  disclosureQueryStart,
  getCorpSyncState,
  insertDisclosures,
  listCachedDisclosures,
  markDisclosuresComplete,
  needsBusinessReportFetch,
  planDartFetch,
} from "../../../db/repositories/dart-evidence-cache.repository.ts";
import {
  dartBudgetUsed,
  fetchDisclosureText,
  fetchFinancials,
  isDartConfigured,
  listDisclosuresSince,
  selectEvidenceBusinessReport,
  validateCorpCode,
} from "./dart-client.ts";
import {
  DartSyncError,
  getCompanyFinancialFacts,
  factRowsToDartItems,
  syncCompanyFinancialFacts,
} from "./dart-financial-facts.ts";
import { deriveFinancialAnalysis } from "./company-financials.ts";
import {
  computeEvalScore,
  targetEvalStates,
  type EvalCategory,
  type EvalCriterion,
  type EvalStateRow,
  type EvalStatus,
} from "./brownfield-eval-criteria.ts";
import { draftFinancialVerdict, isFinancialDataRef } from "./brownfield-financial-rubric.ts";
import {
  disclosureEvidenceBlock,
  parseTechnicalDrafts,
  profileEvidenceBlock,
  technicalDraftUserContent,
  webEvidenceBlock,
  type TechnicalCriterionInput,
} from "./brownfield-technical-draft.ts";
import {
  BUSINESS_REPORT_EXTRACTOR_VERSION,
  businessReportWindowsBlock,
  selectPromptWindows,
  windowCitation,
  type EvidenceWindow,
  ensureBusinessReportExtract,
  parseExtractSections,
  validateCitationsDetailed,
  webCitation,
  type ValidCitation,
} from "./brownfield-business-report.ts";
import { loadLatestProfile } from "./company-profile-pipeline.ts";
import { listConfirmedCompetitors } from "./company-competitors.ts";
import { completeOrFallback, isLlmConfigured } from "./llm.ts";
import { systemMessage } from "./prompts.ts";
import { isWebResearchConfigured, researchSources, type WebSource } from "./web-research.ts";

// ---------------------------------------------------------------------------------------------------------------
// Constants and dependencies.
// ---------------------------------------------------------------------------------------------------------------

/** Budget left must stay >= max(PER_CANDIDATE_RESERVE, INTERACTIVE_FLOOR_RATIO x budget) before a candidate starts (§6.3). */
export const PER_CANDIDATE_RESERVE = 40;
export const INTERACTIVE_FLOOR_RATIO = 0.1;
export const TECHNICAL_PROMPT_KEY = "s7.screening_draft";
/**
 * Identity of how technical evidence is constructed for the prompt. Bump this
 * whenever window selection, the prompt user-content block, or the excerpt
 * strategy changes — otherwise the unchanged-input hash hides a new draft
 * behind an "unchanged" outcome.
 */
export const TECHNICAL_EVIDENCE_KEY = "windows-v1";

export function dartReserve(budget: number): number {
  return Math.max(PER_CANDIDATE_RESERVE, Math.ceil(budget * INTERACTIVE_FLOOR_RATIO));
}

/** Network/LLM seams. Production uses the real modules; tests inject fakes (no DART, LLM or web call leaves the process). */
export interface BulkEvalDeps {
  now: () => string;
  isDartConfigured: () => boolean;
  isLlmConfigured: () => boolean;
  budget: () => { calls: number; budget: number };
  fetcher: typeof fetchFinancials;
  validator: typeof validateCorpCode;
  listDisclosuresSince: typeof listDisclosuresSince;
  fetchDisclosureText: typeof fetchDisclosureText;
  complete: typeof completeOrFallback;
  isWebConfigured: () => boolean;
  webSearch: (query: string) => Promise<WebSource[]>;
}

const defaultDeps: BulkEvalDeps = {
  now: () => new Date().toISOString(),
  isDartConfigured,
  isLlmConfigured,
  budget: () => {
    const b = dartBudgetUsed();
    return { calls: b.calls, budget: b.budget };
  },
  fetcher: fetchFinancials,
  validator: validateCorpCode,
  listDisclosuresSince,
  fetchDisclosureText,
  complete: completeOrFallback,
  isWebConfigured: isWebResearchConfigured,
  webSearch: (q) => researchSources([q], 3),
};

let testDeps: Partial<BulkEvalDeps> | null = null;
/** Test seam: route-started engines use these instead of the network. Pass null to restore. */
export function setBulkEvalDepsForTests(deps: Partial<BulkEvalDeps> | null): void {
  testDeps = deps;
}

/** The DART budget snapshot the engine and the routes both read (honours the test seam). */
export function currentBudget(): { calls: number; budget: number } {
  return { ...defaultDeps, ...(testDeps ?? {}) }.budget();
}

const activeEngines = new Map<string, string>(); // runId -> opportunityId

/** The run id of an engine still executing for this opportunity in THIS process (even a cancelled one finishing its item). */
export function activeEngineRunForOpportunity(oppId: string): string | null {
  for (const [runId, opp] of activeEngines) if (opp === oppId) return runId;
  return null;
}

/** Per-user cooldown between run starts (stops a start-cancel-start loop from hammering DART/LLM/web). */
export const START_COOLDOWN_MS = 30_000;
let startCooldownMs = START_COOLDOWN_MS;
const lastStartByUser = new Map<string, number>();
/** Milliseconds the user must still wait before starting another run (0 = may start). */
export function startCooldownRemaining(userId: string, nowMs: number = Date.now()): number {
  const last = lastStartByUser.get(userId);
  return last === undefined ? 0 : Math.max(0, last + startCooldownMs - nowMs);
}
export function noteRunStart(userId: string, nowMs: number = Date.now()): void {
  lastStartByUser.set(userId, nowMs);
}
/** Test seam: 0 disables the cooldown; the map is cleared. */
export function setStartCooldownForTests(ms: number): void {
  startCooldownMs = ms;
  lastStartByUser.clear();
}
/** True while an engine for the run is executing in THIS process (guards lazy interruption and double resume). */
export function isEngineActive(runId: string): boolean {
  return activeEngines.has(runId);
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------------------------------------------

type EvalItem = EvalCriterion & { state: EvalStateRow | null };

/** budget/rate-limit text raised by dartFetch / dartJson (and surfaced through fetchFinancials year details). */
export function classifyDartPause(
  message: string | null | undefined,
): "dart_budget_exhausted" | "dart_status_020" | null {
  const m = message ?? "";
  if (m.includes("DART 일 호출 예산 초과")) return "dart_budget_exhausted";
  if (m.includes("DART_RATE_LIMITED") || /status 020\b/.test(m)) return "dart_status_020";
  return null;
}

const errMsg = (e: unknown): string => redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Strip API keys / DART URLs from any text before it is logged or stored (defensive; fetch errors may echo the URL). */
export function redactSecrets(text: string): string {
  return text
    .replace(/crtfc_key=[^&\s"')]*/gi, "crtfc_key=***")
    .replace(/https?:\/\/[^\s"')]*opendart[^\s"')]*/gi, "[dart-url]");
}

export type ErrorCode = "dart_error" | "llm_error" | "parse_error" | "db_error" | "unknown";

/** Fixed codes only reach error_message / responses; the detail is logged server-side (redacted). */
export function errorCodeOf(e: unknown): ErrorCode {
  const m = e instanceof Error ? e.message : String(e);
  if (e instanceof DartSyncError || /^business_report_fetch_failed|DART|opendart/i.test(m)) return "dart_error";
  if (m.startsWith("llm_failed")) return "llm_error";
  if (m.startsWith("llm_unparseable")) return "parse_error";
  if (e instanceof EvalDraftError || (e instanceof Error && /sqlite/i.test(`${e.name} ${m}`))) return "db_error";
  return "unknown";
}

function parseRubric(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function criteriaSnapshot(items: EvalItem[]): EvalDraftPayload["criteria_snapshot"] {
  return items.map((c) => ({
    criterion_id: c.id,
    label: c.label,
    data_ref: c.data_ref ?? null,
    weight: c.weight,
    source: c.source,
    rubric: parseRubric(c.rubric_json),
  }));
}

function humanItems(items: EvalItem[]): EvalDraftPayload["human_items"] {
  return items
    .filter((c) => c.state && c.state.status !== "pending")
    .map((c) => ({
      criterion_id: c.id,
      status: (c.state as EvalStateRow).status,
      assessed_by: (c.state as EvalStateRow).assessed_by,
      assessed_at: (c.state as EvalStateRow).assessed_at,
    }));
}

/** Score the candidate would have if every proposal were confirmed unchanged (a projection, never written, §3.3). */
function provisionalScore(
  category: EvalCategory,
  items: EvalItem[],
  proposals: Map<string, "pass" | "partial" | "fail" | null>,
): EvalDraftPayload["provisional_score"] {
  const scored = computeEvalScore(
    items.map((c) => {
      const human = c.state && c.state.status !== "pending" ? c.state.status : null;
      const status: EvalStatus = human ?? proposals.get(c.id) ?? "pending";
      return { category, weight: c.weight, state: { status } };
    }),
  )[category];
  return { score: scored.score, scored_weight: scored.scoredWeight, total_weight: scored.totalWeight };
}

function categoriesOf(sel: DraftRunRow["categories"]): EvalDraftCategory[] {
  return sel === "both" ? ["financial", "technical"] : [sel];
}

interface TargetCtx {
  id: string;
  company_name: string;
  status: string;
  company_id: string | null;
  company_name_ko: string | null;
  corp_code: string | null;
}

/** Same company-master linkage rule as the detail route / S7 draft route (DART code first, name fallback). */
function loadTarget(db: Database, oppId: string, targetId: string): TargetCtx | null {
  const row = db
    .query(
      `SELECT bt.id, bt.company_name, bt.status,
              COALESCE(
                (SELECT mc.id FROM md_company mc WHERE bt.dart_corp_code IS NOT NULL AND mc.dart_corp_code = bt.dart_corp_code),
                (SELECT mc.id FROM md_company mc WHERE mc.name_ko = bt.company_name)
              ) AS company_id
         FROM brownfield_target bt WHERE bt.id = ? AND bt.opportunity_id = ?`,
    )
    .get(targetId, oppId) as { id: string; company_name: string; status: string; company_id: string | null } | null;
  if (!row) return null;
  const company = row.company_id
    ? (db.query("SELECT name_ko, dart_corp_code FROM md_company WHERE id = ?").get(row.company_id) as {
        name_ko: string;
        dart_corp_code: string | null;
      } | null)
    : null;
  return {
    id: row.id,
    company_name: row.company_name,
    status: row.status,
    company_id: row.company_id,
    company_name_ko: company?.name_ko ?? null,
    corp_code: company?.dart_corp_code ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Engine.
// ---------------------------------------------------------------------------------------------------------------

interface Ctx {
  db: Database;
  deps: BulkEvalDeps;
  runId: string;
  oppId: string;
  actor: string;
  via: string;
  webEvidence: boolean;
  forceRefresh: boolean;
  categories: EvalDraftCategory[];
}

function audit(c: Ctx, action: string, target: string): void {
  appendAudit(c.db, { actor: c.actor, action, target, now: c.deps.now() });
}

/** Fire-and-forget launch (the S1 rerun precedent): the request returns 202 while the engine works through the run. */
export function launchBulkEval(db: Database, runId: string): void {
  if (activeEngines.has(runId)) return;
  void runBulkEval(db, runId).catch((err) => {
    console.error("brownfield bulk eval engine failed:", errMsg(err));
    try {
      const run = getRun(db, runId);
      if (run && (run.status === "running" || run.status === "paused_budget" || run.status === "interrupted")) {
        finishRun(db, runId, "failed", new Date().toISOString(), errorCodeOf(err));
      }
    } catch {
      /* the lazy heartbeat check will surface the run as interrupted */
    }
  });
}

/**
 * Process a run to completion, a pause, or cancellation. Resumes at the first non-terminal item. Safe to call again
 * after resumeRun; a second concurrent call for the same run returns immediately.
 */
export async function runBulkEval(db: Database, runId: string, override: Partial<BulkEvalDeps> = {}): Promise<void> {
  if (activeEngines.has(runId)) return;
  const deps: BulkEvalDeps = { ...defaultDeps, ...(testDeps ?? {}), ...override };
  activeEngines.set(runId, getRun(db, runId)?.opportunity_id ?? "");
  try {
    for (;;) {
      const run = getRun(db, runId);
      if (run?.status !== "running") return; // cancelled, paused, finished elsewhere
      const c: Ctx = {
        db,
        deps,
        runId,
        oppId: run.opportunity_id,
        actor: run.resumed_by ?? run.started_by,
        via: run.started_via,
        webEvidence: run.web_evidence === 1,
        forceRefresh: run.force_refresh === 1,
        categories: categoriesOf(run.categories),
      };
      const item = nextResumableItem(db, runId);
      if (!item) {
        finishRun(db, runId, "completed", deps.now());
        audit(c, "target_eval.bulk_run.complete", `${run.opportunity_id}:run:${runId}`);
        return;
      }
      const outcome = await processItem(c, item);
      touchRunHeartbeat(db, runId, deps.now());
      if (outcome === "paused") return;
    }
  } finally {
    activeEngines.delete(runId);
  }
}

function pause(c: Ctx, reason: string): "paused" {
  const run = getRun(c.db, c.runId);
  if (run?.status === "running") {
    pauseRun(c.db, c.runId, reason, c.deps.now());
    audit(c, "target_eval.bulk_run.pause", `${c.oppId}:run:${c.runId}:reason=${reason}`);
  }
  return "paused";
}

interface Needs {
  financial: boolean;
  technical: boolean;
  finPending: EvalItem[];
  techPending: EvalItem[];
}

function needsOf(c: Ctx, item: DraftRunItemRow, evalItems: EvalItem[]): Needs {
  const finPending = evalItems.filter(
    (it) =>
      it.category === "financial" &&
      it.source === "builtin" &&
      isFinancialDataRef(it.data_ref) &&
      (it.state?.status ?? "pending") === "pending",
  );
  const techPending = evalItems.filter(
    (it) => it.category === "technical" && (it.state?.status ?? "pending") === "pending",
  );
  return {
    financial: c.categories.includes("financial") && item.financial_outcome === null && finPending.length > 0,
    technical: c.categories.includes("technical") && item.technical_outcome === null && techPending.length > 0,
    finPending,
    techPending,
  };
}

/** A candidate whose fetch plan is fully cached costs 0 DART calls and proceeds even below the reserve (§6.3). */
function fullyCached(c: Ctx, corpCode: string, needs: Needs): boolean {
  const now = c.deps.now();
  const plan = planDartFetch(getCorpSyncState(c.db, corpCode), now, c.forceRefresh);
  if (plan.disclosures) return false;
  if (needs.financial && (plan.financial || plan.corp_code)) return false;
  if (needs.technical) {
    const rows = listCachedDisclosures(c.db, corpCode, disclosureQueryStart(null, now), 500);
    const report = selectEvidenceBusinessReport(rows);
    if (report && needsBusinessReportFetch(c.db, report.rcept_no, BUSINESS_REPORT_EXTRACTOR_VERSION)) return false;
  }
  return true;
}

async function processItem(c: Ctx, item: DraftRunItemRow): Promise<"continue" | "paused"> {
  const { db, deps } = c;
  const target = loadTarget(db, c.oppId, item.brownfield_target_id);
  const skipAll = (state: DraftRunItemRow["state"], error: string | null): "continue" => {
    const out: Partial<Record<"financialOutcome" | "technicalOutcome", CategoryOutcome>> = {};
    if (c.categories.includes("financial")) out.financialOutcome = "skipped";
    if (c.categories.includes("technical")) out.technicalOutcome = "skipped";
    updateRunItem(db, item.id, { state, errorMessage: error, ...out }, deps.now());
    return "continue";
  };
  if (!target || target.status === "excluded") return skipAll("done", "excluded");
  if (!target.company_id || !target.company_name_ko) return skipAll("skipped_no_company", null);
  if (!target.corp_code) return skipAll("skipped_not_dart", null);
  if (!deps.isDartConfigured()) return skipAll("failed", "dart_not_configured");
  const corpCode = target.corp_code;
  const companyId = target.company_id;

  const evalItems = targetEvalStates(c.oppId, target.id, c.actor) as EvalItem[];
  const needs = needsOf(c, item, evalItems);
  const patchNothing: Partial<Record<"financialOutcome" | "technicalOutcome", CategoryOutcome>> = {};
  if (c.categories.includes("financial") && item.financial_outcome === null && needs.finPending.length === 0)
    patchNothing.financialOutcome = "nothing_pending";
  if (c.categories.includes("technical") && item.technical_outcome === null && needs.techPending.length === 0)
    patchNothing.technicalOutcome = "nothing_pending";
  if (Object.keys(patchNothing).length > 0) updateRunItem(db, item.id, patchNothing, deps.now());
  if (!needs.financial && !needs.technical) {
    updateRunItem(db, item.id, { state: "done" }, deps.now());
    return "continue";
  }

  // Reserve rule (§6.3) — checked before each candidate, with the fully-cached exemption.
  const b0 = deps.budget();
  if (b0.budget - b0.calls < dartReserve(b0.budget) && !fullyCached(c, corpCode, needs)) {
    return pause(c, "dart_budget_reserve");
  }

  const calls0 = b0.calls;
  const spent = () => Math.max(0, deps.budget().calls - calls0);
  const errors: string[] = [];
  let anyFailed = false;
  const failCategory = (cat: EvalDraftCategory, cause: unknown): void => {
    anyFailed = true;
    const code = typeof cause === "string" ? cause : errorCodeOf(cause);
    if (typeof cause !== "string") console.error(`bulk eval ${cat} step failed (${code}):`, errMsg(cause));
    errors.push(`${cat}: ${code}`);
    updateRunItem(
      db,
      item.id,
      cat === "financial" ? { financialOutcome: "failed" } : { technicalOutcome: "failed" },
      deps.now(),
    );
  };
  const paused = (reason: string): "paused" => {
    updateRunItem(db, item.id, { addDartCalls: spent() }, deps.now());
    return pause(c, reason);
  };

  // ── step 1+2: disclosure list, then financial facts (state financial_sync) ──
  let disclosureError: string | null = null;
  if (item.state === "pending" || item.state === "financial_sync") {
    updateRunItem(db, item.id, { state: "financial_sync" }, deps.now());
    const now = deps.now();
    const sync = getCorpSyncState(db, corpCode);
    if (planDartFetch(sync, now, c.forceRefresh).disclosures) {
      const end = disclosureQueryEnd(now);
      const res = await deps.listDisclosuresSince(corpCode, disclosureQueryStart(sync, now), end);
      // Rows from pages that succeeded are true, immutable facts; the cursor moves only after the LAST page (§7).
      insertDisclosures(db, res.rows, now);
      if (res.complete) markDisclosuresComplete(db, corpCode, end, now);
      else {
        const pr = classifyDartPause(res.error);
        if (pr) return paused(pr);
        disclosureError = res.error ?? "disclosure list failed";
      }
    }
    if (needs.financial) {
      try {
        const r = await syncCompanyFinancialFacts(db, companyId, {
          incremental: true,
          forceRefresh: c.forceRefresh,
          now: deps.now(),
          fetcher: deps.fetcher,
          validator: deps.validator,
        });
        const pr = (r.fetch_errors ?? []).map(classifyDartPause).find((x) => x !== null);
        if (pr) return paused(pr);
      } catch (e) {
        const pr = classifyDartPause(errMsg(e));
        if (pr) return paused(pr);
        failCategory("financial", e);
      }
    }
    updateRunItem(db, item.id, { state: "financial_draft" }, deps.now());
  }

  // ── step 3: financial draft (deterministic rubric) ──
  const fresh = getRunRowItem(db, item.id);
  if (needs.financial && fresh.financial_outcome === null) {
    try {
      await financialDraft(c, fresh, target, companyId, corpCode, evalItems, needs.finPending);
    } catch (e) {
      failCategory("financial", e);
    }
  }
  updateRunItem(db, item.id, { state: "technical_draft" }, deps.now());

  // ── step 4+5: business-report body, then technical draft ──
  let llmSkipped = false;
  if (needs.technical) {
    const cur = getRunRowItem(db, item.id);
    if (cur.technical_outcome === null) {
      if (!deps.isLlmConfigured()) {
        // A deliberately unconfigured LLM is not a failure, and must not mint an all-unverified version (§5).
        llmSkipped = true;
        updateRunItem(db, item.id, { technicalOutcome: "skipped", errorMessage: "llm_unconfigured" }, deps.now());
      } else if (disclosureError) {
        console.error("bulk eval disclosure list failed:", redactSecrets(disclosureError));
        failCategory("technical", "dart_error");
      } else {
        try {
          const r = await technicalDraft(c, cur, target, companyId, corpCode, evalItems, needs.techPending);
          if (r !== "done") return paused(r.pause);
        } catch (e) {
          const pr = classifyDartPause(errMsg(e));
          if (pr) return paused(pr);
          failCategory("technical", e);
        }
      }
    }
  }

  const finalState: DraftRunItemRow["state"] = anyFailed
    ? "failed"
    : llmSkipped && !needs.financial
      ? "skipped_llm_unconfigured"
      : "done";
  updateRunItem(
    db,
    item.id,
    {
      state: finalState,
      addDartCalls: spent(),
      ...(anyFailed ? { errorMessage: errors.join(" | ").slice(0, 1000) } : {}),
    },
    deps.now(),
  );
  return "continue";
}

function getRunRowItem(db: Database, itemId: string): DraftRunItemRow {
  return db
    .query(
      "SELECT id, run_id, brownfield_target_id, seq, state, financial_outcome, technical_outcome, financial_version_id, technical_version_id, dart_calls, error_message, updated_at FROM brownfield_eval_draft_run_item WHERE id = ?",
    )
    .get(itemId) as DraftRunItemRow;
}

// ---------------------------------------------------------------------------------------------------------------
// Financial draft.
// ---------------------------------------------------------------------------------------------------------------

async function financialDraft(
  c: Ctx,
  item: DraftRunItemRow,
  target: TargetCtx,
  companyId: string,
  corpCode: string,
  evalItems: EvalItem[],
  pending: EvalItem[],
): Promise<void> {
  const { db, deps } = c;
  const facts = getCompanyFinancialFacts(db, companyId);
  const catItems = evalItems.filter((it) => it.category === "financial");
  // Inputs are fully known after evidence assembly, BEFORE the rubric runs (§3.3).
  const inputHash = computeDraftInputHash({
    v: 1,
    category: "financial",
    facts: facts.rows
      .map((r) => [r.fiscal_year, r.account_name, r.value, r.revision_no])
      .sort((a, b) => (a[0] as number) - (b[0] as number) || String(a[1]).localeCompare(String(b[1]))),
    criteria: criteriaSnapshot(catItems),
    human: humanItems(catItems).map((h) => [h.criterion_id, h.status]),
  });
  const now = deps.now();
  const result = await commitCategoryDraft(db, {
    itemId: item.id,
    category: "financial",
    inputHash,
    createdBy: c.actor,
    now,
    produce: (): DraftVersionContent => {
      const analysis = deriveFinancialAnalysis({
        corpCode: facts.company.dart_corp_code ?? "",
        found: facts.rows.length > 0,
        items: factRowsToDartItems(facts.rows),
        yearly: [],
      } as Parameters<typeof deriveFinancialAnalysis>[0]);
      const items: EvalDraftPayload["items"] = pending.map((it) => {
        const d = draftFinancialVerdict(
          it.data_ref as Parameters<typeof draftFinancialVerdict>[0],
          analysis,
          it.rubric_json,
        );
        return {
          criterion_id: it.id,
          proposed_status: d.status,
          reason: d.reason,
          metrics: d.metrics,
          note: d.note,
          citations: [],
        };
      });
      const proposals = new Map(items.map((i) => [i.criterion_id, i.proposed_status] as const));
      const proposed = items.filter((i) => i.proposed_status !== null).length;
      const grade: EvidenceGrade = proposed > 0 ? "A" : "U"; // ADR-0187 D1: filed statements + deterministic rubric, or no proposal possible
      const sync = getCorpSyncState(db, corpCode);
      const payload: EvalDraftPayload = {
        schema: 1,
        category: "financial",
        criteria_snapshot: criteriaSnapshot(catItems),
        items,
        human_items: humanItems(catItems),
        provisional_score: provisionalScore("financial", catItems, proposals),
        dart: {
          corp_code: corpCode,
          base_years: analysis.years.map(Number),
          latest_sync_at: facts.latest_sync_at ?? sync?.financial_checked_at ?? null,
          sync_warnings: [],
        },
        evidence: { disclosures: [], business_report: null, profile: { present: false, version_no: null }, web: [] },
        llm: null,
        runner: { user_id: c.actor, via: c.via },
        generated_at: now,
      };
      return {
        payload,
        provisionalScore: payload.provisional_score.score,
        proposedCount: proposed,
        unverifiedCount: items.length - proposed,
        evidenceGrade: grade,
      };
    },
  });
  auditVersion(c, target.id, "financial", result.outcome, result.version.version_no);
}

function auditVersion(
  c: Ctx,
  targetId: string,
  category: EvalDraftCategory,
  outcome: "versioned" | "unchanged",
  versionNo: number,
): void {
  audit(
    c,
    outcome === "versioned" ? "target_eval.draft_version.create" : "target_eval.draft_version.unchanged",
    `${c.oppId}:${targetId}:${category}:v${versionNo}:run=${c.runId}`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Technical draft.
// ---------------------------------------------------------------------------------------------------------------

const VERDICT_KO: Record<"pass" | "partial" | "fail", string> = { pass: "충족", partial: "부분충족", fail: "미충족" };

/** Returns `{ pause }` when the business-report fetch hit the budget / rate limit; throws on other failures. */
async function technicalDraft(
  c: Ctx,
  item: DraftRunItemRow,
  target: TargetCtx,
  companyId: string,
  corpCode: string,
  evalItems: EvalItem[],
  pending: EvalItem[],
): Promise<"done" | { pause: string }> {
  const { db, deps } = c;
  const companyName = target.company_name_ko ?? target.company_name;
  const now = deps.now();
  const since = disclosureQueryStart(null, now); // 36 months back
  const evidenceDisclosures = listCachedDisclosures(db, corpCode, since);
  const report = selectEvidenceBusinessReport(listCachedDisclosures(db, corpCode, since, 500));

  // Business-report body (per rcept_no, never re-fetched): transient failure -> no row, category fails/pauses.
  let extract = null as Awaited<ReturnType<typeof ensureBusinessReportExtract>>["extract"];
  if (report) {
    const ensured = await ensureBusinessReportExtract(db, report.rcept_no, deps.fetchDisclosureText, now);
    if (ensured.status === "transient") {
      const pr = classifyDartPause(ensured.error);
      if (pr) return { pause: pr };
      console.error("bulk eval business report fetch failed:", redactSecrets(ensured.error ?? "unknown"));
      throw new Error("business_report_fetch_failed");
    }
    extract = ensured.extract;
  }
  const sections = parseExtractSections(extract);
  const reportAvailable = extract?.status === "extracted";

  // Evidence 1 — company AI profile (internal: used as prompt context only, never copied into the payload).
  const profile = loadLatestProfile(db, { kind: "company", id: companyId });
  const confirmedCompetitors = listConfirmedCompetitors(db, { kind: "company", id: companyId });
  const profileText = profileEvidenceBlock(profile, confirmedCompetitors);
  const profileVersion =
    (
      db
        .query("SELECT version_no FROM company_profile_version WHERE company_id = ? ORDER BY version_no DESC LIMIT 1")
        .get(companyId) as { version_no: number } | null
    )?.version_no ?? null;

  // Evidence 3 — web search ONLY on the explicit per-run opt-in, and only inside produce (after the unchanged-hash
  // short-circuit), so unchanged inputs cost no web call. Queries carry nothing but company + criterion label.
  const webByCriterion = new Map<string, WebSource[]>();

  const catItems = evalItems.filter((it) => it.category === "technical");
  const criteria: TechnicalCriterionInput[] = pending.map((it) => ({
    id: it.id,
    label: it.label,
    description: it.description,
  }));
  const inputHash = computeDraftInputHash({
    v: 1,
    category: "technical",
    criteria: criteriaSnapshot(catItems),
    human: humanItems(catItems).map((h) => [h.criterion_id, h.status]),
    disclosures: evidenceDisclosures.map((d) => d.rcept_no),
    business_report: {
      rcept_no: report?.rcept_no ?? null,
      extract: extract ? [extract.status, extract.content_hash] : null,
    },
    profile: computeDraftInputHash(profileText),
    web_evidence: c.webEvidence,
    prompt_key: TECHNICAL_PROMPT_KEY,
    evidence_key: TECHNICAL_EVIDENCE_KEY,
  });

  const evidenceSummary = () => {
    const webCount = [...webByCriterion.values()].reduce((a, b) => a + b.length, 0);
    return `공시 ${evidenceDisclosures.length}건(3년) · ${reportAvailable ? "사업보고서 본문" : "사업보고서 본문 확보 실패"} · ${profile ? "AI 프로파일" : "프로파일 없음"} · 웹 ${webCount}건`;
  };

  const result = await commitCategoryDraft(db, {
    itemId: item.id,
    category: "technical",
    inputHash,
    createdBy: c.actor,
    now,
    produce: async (): Promise<DraftVersionContent> => {
      if (c.webEvidence && deps.isWebConfigured()) {
        for (const it of pending) {
          try {
            const sources = await deps.webSearch(`${companyName} ${it.label}`);
            if (sources.length > 0) webByCriterion.set(it.id, sources.slice(0, 3));
          } catch {
            /* a failed search simply leaves that item without web evidence */
          }
        }
      }
      const windows = selectPromptWindows(sections, criteria);
      const webCounts = new Map([...webByCriterion].map(([id, ws]) => [id, ws.length] as const));
      const llmRes = await deps.complete(
        [
          systemMessage(TECHNICAL_PROMPT_KEY),
          {
            role: "user" as const,
            content: technicalDraftUserContent(companyName, criteria, {
              profile: profileText,
              disclosures: disclosureEvidenceBlock(evidenceDisclosures),
              web: webEvidenceBlock(webByCriterion, criteria),
              businessReport: businessReportWindowsBlock(report?.rcept_no ?? null, windows, webCounts),
            }),
          },
        ],
        () => "",
        {
          maxTokens: 2400,
          agent: {
            key: "brownfield-agent",
            purpose: "S6 일괄 기술 평가 판정 초안 — 공시·사업보고서·프로파일 근거 기반",
            contextType: "opportunity",
            contextId: c.oppId,
          },
        },
      );
      // ADR-0131: a genuine LLM failure never overwrites a good version — the step fails, no version is written.
      if (llmRes.source !== "llm") throw new Error("llm_failed");
      const parsed = parseTechnicalDrafts(llmRes, webByCriterion, criteria);
      if (Object.keys(parsed).length === 0) throw new Error("llm_unparseable");

      const citeCtx = {
        rceptNo: report?.rcept_no ?? null,
        sections,
        disclosures: evidenceDisclosures,
        profileText: profile ? profileText : null,
      };
      let citationsRejected = 0;
      const items: EvalDraftPayload["items"] = pending.map((it) => {
        const d = parsed[it.id];
        const metrics = [{ label: "근거", value: evidenceSummary() }];
        const web = webByCriterion.get(it.id) ?? [];
        const unverified = (why: string, code?: ReasonDetailCode) => ({
          ...(code ? { reason_detail: code } : {}),
          criterion_id: it.id,
          proposed_status: null,
          reason: `확인 안됨 — ${why}`,
          metrics,
          note: `확인 안됨(자동 진단, ${evidenceSummary()}) — ${why}. 판정은 사람이 직접 기록.`,
          citations: [] as ValidCitation[],
        });
        if (!d)
          return unverified(
            "LLM이 이 항목에 응답하지 않아 판정 보류",
            !reportAvailable && web.length === 0 ? "evidence_unavailable" : "llm_omitted",
          );
        if (d.verdict === "unverified") return unverified(d.rationale || "근거 부족");
        // Verdicts need at least one citation that exists in the evidence we hold; anything else stays unverified.
        // Provenance by construction: the model only names an evidence number; the engine copies the quote out of
        // the numbered window (or derives the web citation). An index that matches nothing lifts nothing.
        const wins: EvidenceWindow[] = windows.get(it.id) ?? [];
        const rawIdx = d.source_index ?? null;
        const win = rawIdx !== null && rawIdx > web.length ? wins[rawIdx - web.length - 1] : undefined;
        const citations: ValidCitation[] = [];
        if (win && report) {
          // Belt and braces: the derived quote must still be a verbatim part of the extracted section.
          const checked = validateCitationsDetailed([windowCitation(report.rcept_no, win)], citeCtx);
          citations.push(...checked.valid);
          citationsRejected += checked.rejected.length;
        }
        if (d.source_url) {
          const src = web.find((s) => s.url === d.source_url);
          if (src) citations.push(webCitation(src));
        }
        if (!citations.some((x) => x.kind === "business_report" || x.kind === "web")) {
          const code: ReasonDetailCode =
            wins.length === 0 && web.length === 0
              ? "evidence_unavailable"
              : rawIdx === null
                ? "no_citation"
                : "ref_unknown";
          if (rawIdx !== null) citationsRejected++;
          return unverified("근거 번호가 없거나 가리키는 근거를 확인할 수 없어 판정 보류", code);
        }
        if (d.source_url) {
          try {
            metrics.push({ label: "출처", value: new URL(d.source_url).hostname });
          } catch {
            metrics.push({ label: "출처", value: d.source_url });
          }
        }
        return {
          criterion_id: it.id,
          proposed_status: d.verdict as "pass" | "partial" | "fail",
          reason: null,
          metrics,
          note: `자동초안(공시·사업보고서·프로파일·웹 근거, 수정 가능) — ${d.rationale} → ${VERDICT_KO[d.verdict as "pass" | "partial" | "fail"]} 제안`,
          citations,
        };
      });
      const proposals = new Map(items.map((i) => [i.criterion_id, i.proposed_status] as const));
      const proposed = items.filter((i) => i.proposed_status !== null).length;
      const sync = getCorpSyncState(db, corpCode);
      const payload: EvalDraftPayload = {
        schema: 1,
        category: "technical",
        criteria_snapshot: criteriaSnapshot(catItems),
        items,
        human_items: humanItems(catItems),
        provisional_score: provisionalScore("technical", catItems, proposals),
        dart: {
          corp_code: corpCode,
          base_years: [],
          latest_sync_at: sync?.disclosures_checked_at ?? null,
          sync_warnings: [],
        },
        evidence: {
          llm_drafts_returned: Object.keys(parsed).length,
          citations_rejected: citationsRejected,
          disclosures: evidenceDisclosures.map((d) => ({
            rcept_no: d.rcept_no,
            rcept_dt: d.rcept_dt,
            report_nm: d.report_nm,
          })),
          business_report: {
            rcept_no: report?.rcept_no ?? null,
            rcept_dt: report?.rcept_dt ?? null,
            available: reportAvailable,
            sections_found: Object.keys(sections),
            truncated: Object.values(sections).some((s) => s?.truncated),
            error: !report ? "no_business_report" : extract?.status === "extracted" ? null : (extract?.status ?? null),
          },
          profile: { present: profile !== null, version_no: profileVersion },
          web: [...webByCriterion.entries()].flatMap(([criterionId, srcs]) =>
            srcs.map((s) => {
              let host = "";
              try {
                host = new URL(s.url).hostname;
              } catch {
                /* keep empty */
              }
              return { criterion_id: criterionId, url: s.url, host };
            }),
          ),
        },
        llm: { source: llmRes.source, provider: llmRes.provider, prompt_key: TECHNICAL_PROMPT_KEY },
        runner: { user_id: c.actor, via: c.via },
        generated_at: now,
      };
      return {
        payload,
        provisionalScore: payload.provisional_score.score,
        proposedCount: proposed,
        unverifiedCount: items.length - proposed,
        evidenceGrade: "C", // LLM interpretation of evidence; quotes strengthen citations but do not lift the class (§3.4)
      };
    },
  });
  auditVersion(c, target.id, "technical", result.outcome, result.version.version_no);
  return "done";
}

/** Items of a run with the candidate name — read model for the A2 progress route. */
export function runItemsWithNames(
  db: Database,
  runId: string,
): Array<DraftRunItemRow & { company_name: string | null }> {
  const names = new Map(
    (
      db
        .query(
          `SELECT bt.id, bt.company_name FROM brownfield_target bt
            WHERE bt.id IN (SELECT brownfield_target_id FROM brownfield_eval_draft_run_item WHERE run_id = ?)`,
        )
        .all(runId) as Array<{ id: string; company_name: string }>
    ).map((r) => [r.id, r.company_name] as const),
  );
  return listRunItems(db, runId).map((i) => ({ ...i, company_name: names.get(i.brownfield_target_id) ?? null }));
}
