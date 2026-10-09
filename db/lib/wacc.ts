// @version 1.2.0
/**
 * Project-scoped WACC input session (Wave C1; components since ADR-0115).
 *
 * The assumption table is run-scoped, so "project WACC" is resolved through
 * the latest run for the project. A confirmed user value is recorded twice:
 *   1. as immutable run_input (`wacc`, and optionally `hurdle_irr`) so model
 *      snapshots reproduce; and
 *   2. as assumption rows with kind='user' so FS kill criteria can prove a
 *      human explicitly confirmed the values.
 *
 * ADR-0115: a session may additionally carry CAPM components, persisted as
 * assumption rows under the `wacc.<name>` namespace on the SAME run — the
 * derivation (db/lib/wacc-components.ts) re-derives the build-up from those
 * rows on read, so the confirmed scalar always has a reproducible "how".
 * The `wacc` / `hurdle_irr` exact-key contract with snapshot-filler.ts is
 * deliberately untouched by the namespace.
 *
 * Missing WACC deliberately degrades to the historical 10% modeling default,
 * but the resolver labels that provenance as `default`, never as user input.
 */

import type { Database } from "bun:sqlite";
import { recordAssumption } from "./assumption.ts";
import { createRun } from "./versioning.ts";
import {
  validateComponentInput,
  type WaccComponentInput,
} from "./wacc-components.ts";

export const DEFAULT_WACC = 0.1;

// ── WACC application subject (design 2026-09-18-s8-business-case-evaluation REQ-W4-1..4) ──
// The discount rate follows the RISK OF THE CASH FLOWS, not the legal form:
// greenfield self-execution discounts at the promoter's cost of capital, an
// acquisition or equity stake at the TARGET's risk (relevered to the pro-forma
// structure), and a ring-fenced newco at its own structure. NULL on
// md_project = the track-based default applies.

export const WACC_SUBJECTS = ["promoter", "target", "project_newco"] as const;
export type WaccSubject = (typeof WACC_SUBJECTS)[number];

export interface WaccSubjectResolution {
  subject: WaccSubject;
  source: "user" | "track_default";
  rationale: string | null;
  decided_by: string | null;
  decided_at: string | null;
  /** The track the default was derived from (null when the user decided). */
  default_track: "greenfield" | "brownfield" | null;
}

export function isWaccSubject(value: unknown): value is WaccSubject {
  return typeof value === "string" && (WACC_SUBJECTS as readonly string[]).includes(value);
}

/** The track-based default (REQ-W4-2): greenfield self-execution -> promoter;
 *  brownfield (acquisition / equity participation) -> target. */
export function trackDefaultSubject(track: "greenfield" | "brownfield" | null): WaccSubject {
  return track === "brownfield" ? "target" : "promoter";
}

/** Resolve the project's WACC subject: the recorded user decision, else the
 *  track default derived from the source opportunity's route decision. */
export function resolveProjectWaccSubject(db: Database, projectId: string): WaccSubjectResolution {
  const row = db
    .query(
      `SELECT p.wacc_subject, p.wacc_subject_rationale, p.wacc_subject_decided_by, p.wacc_subject_decided_at, rd.track
       FROM md_project p
       LEFT JOIN opportunity o ON o.id = p.source_opportunity_id
       LEFT JOIN route_decision rd ON rd.opportunity_id = o.id AND rd.is_current = 1
       WHERE p.id = ?`,
    )
    .get(projectId) as
    | { wacc_subject: string | null; wacc_subject_rationale: string | null; wacc_subject_decided_by: string | null; wacc_subject_decided_at: string | null; track: string | null }
    | undefined;
  if (row?.wacc_subject && isWaccSubject(row.wacc_subject)) {
    return { subject: row.wacc_subject, source: "user", rationale: row.wacc_subject_rationale, decided_by: row.wacc_subject_decided_by, decided_at: row.wacc_subject_decided_at, default_track: null };
  }
  const track = row?.track === "brownfield" ? "brownfield" : row?.track === "greenfield" ? "greenfield" : null;
  return { subject: trackDefaultSubject(track), source: "track_default", rationale: null, decided_by: null, decided_at: null, default_track: track };
}

/** Record the user's subject decision — enum-validated, rationale mandatory
 *  (REQ-W4-1: the fs gate reviews the choice, not a silent constant). */
export function setProjectWaccSubject(db: Database, projectId: string, subject: WaccSubject, rationale: string, actor: string, now = new Date().toISOString()): void {
  if (!isWaccSubject(subject)) throw new Error(`invalid wacc subject: ${subject}`);
  const trimmed = rationale.trim();
  if (!trimmed) throw new Error("wacc subject rationale is required");
  db.run(
    `UPDATE md_project SET wacc_subject = ?, wacc_subject_rationale = ?, wacc_subject_decided_by = ?, wacc_subject_decided_at = ? WHERE id = ?`,
    [subject, trimmed, actor, now, projectId],
  );
}

/** Relevering support (REQ-W4-3): beta_levered = beta_unlevered x (1 + (1 −
 *  tax_rate) x D/E) from the latest session's components. null when the
 *  components are absent — the derivation table shows the gap, never a guess. */
export function resolveReleveredBeta(db: Database, projectId: string, scope: WaccScope = {}): { beta_levered: number; beta_unlevered: number; target_de: number; tax_rate: number } | null {
  const { components } = loadProjectComponents(db, projectId, scope);
  const byKey = new Map(components.map((c) => [c.key, c]));
  const bu = byKey.get("wacc.beta_unlevered");
  const de = byKey.get("wacc.target_de") ?? byKey.get("wacc.observed_de");
  const tax = byKey.get("wacc.tax_rate");
  if (!bu || !de) return null;
  const taxRate = tax ? tax.value : 0;
  return {
    beta_unlevered: bu.value,
    target_de: de.value,
    tax_rate: taxRate,
    beta_levered: bu.value * (1 + (1 - taxRate) * de.value),
  };
}

export interface WaccResolution {
  value: number;
  source: "user" | "run_input" | "default";
  assumption_id: string | null;
  run_id: string | null;
  as_of: string | null;
  rationale: string | null;
  anchor_ref: string | null;
}

export interface WaccSessionResult {
  run_id: string;
  wacc: WaccResolution;
  hurdle_irr: WaccResolution | null;
}

/** One persisted CAPM component, read back from the assumption registry. */
export interface WaccComponentRecord {
  key: string;
  kind: string;
  value: number;
  rationale: string | null;
  anchor_ref: string | null;
  as_of: string;
  run_id: string;
}

function assertRate(key: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= -1) {
    throw new Error(`${key} must be a finite rate greater than -1.`);
  }
}

function latestAssumption(db: Database, projectId: string, key: "wacc" | "hurdle_irr", subjectCompanyId: string | null): WaccResolution | null {
  const row = db
    .query(
      `SELECT a.id, a.run_id, a.value, a.as_of, a.rationale, a.anchor_ref
       FROM assumption a JOIN run r ON r.id = a.run_id
       WHERE r.project_id = ? AND a.assumption_key = ? AND a.kind = 'user'
         AND r.subject_company_id IS ?
       ORDER BY a.as_of DESC, r.created_at DESC, a.id DESC
       LIMIT 1`,
    )
    .get(projectId, key, subjectCompanyId) as
    | { id: string; run_id: string; value: number; as_of: string; rationale: string | null; anchor_ref: string | null }
    | undefined;
  if (!row) return null;
  return {
    value: row.value,
    source: "user",
    assumption_id: row.id,
    run_id: row.run_id,
    as_of: row.as_of,
    rationale: row.rationale,
    anchor_ref: row.anchor_ref,
  };
}

function latestRunInput(db: Database, projectId: string, key: "wacc" | "hurdle_irr", subjectCompanyId: string | null): WaccResolution | null {
  const row = db
    .query(
      `SELECT r.id AS run_id, ri.value, r.created_at
       FROM run r JOIN run_input ri ON ri.run_id = r.id
       WHERE r.project_id = ? AND ri.assumption_key = ?
         AND r.subject_company_id IS ?
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 1`,
    )
    .get(projectId, key, subjectCompanyId) as { run_id: string; value: number; created_at: string } | undefined;
  if (!row) return null;
  return {
    value: row.value,
    source: "run_input",
    assumption_id: null,
    run_id: row.run_id,
    as_of: row.created_at,
    rationale: "Versioned run_input exists without a user assumption row.",
    anchor_ref: null,
  };
}

/**
 * Scope: null = project-level (the fs-gate figure; only runs stamped with no
 * subject company — the grandfathered shape), a company id = that shortlisted
 * target's own sessions (ADR-0156).
 */
export interface WaccScope {
  subjectCompanyId?: string | null;
}

export function resolveProjectWacc(db: Database, projectId: string, scope: WaccScope = {}): WaccResolution {
  const company = scope.subjectCompanyId ?? null;
  return (
    latestAssumption(db, projectId, "wacc", company) ??
    latestRunInput(db, projectId, "wacc", company) ??
    {
      value: DEFAULT_WACC,
      source: "default",
      assumption_id: null,
      run_id: null,
      as_of: null,
      rationale: "Historical deterministic fallback; run the WACC input session before FS gate.",
      anchor_ref: null,
    }
  );
}

export function resolveProjectHurdleIrr(db: Database, projectId: string, scope: WaccScope = {}): WaccResolution | null {
  const company = scope.subjectCompanyId ?? null;
  return latestAssumption(db, projectId, "hurdle_irr", company) ?? latestRunInput(db, projectId, "hurdle_irr", company);
}

export function resolveRunWacc(db: Database, runId: string): WaccResolution | null {
  const user = db
    .query(
      `SELECT id, run_id, value, as_of, rationale, anchor_ref
       FROM assumption
       WHERE run_id = ? AND assumption_key = 'wacc' AND kind = 'user'
       ORDER BY as_of DESC, id DESC
       LIMIT 1`,
    )
    .get(runId) as
    | { id: string; run_id: string; value: number; as_of: string; rationale: string | null; anchor_ref: string | null }
    | undefined;
  if (user) {
    return {
      value: user.value,
      source: "user",
      assumption_id: user.id,
      run_id: user.run_id,
      as_of: user.as_of,
      rationale: user.rationale,
      anchor_ref: user.anchor_ref,
    };
  }
  const input = db
    .query("SELECT assumption_key, value FROM run_input WHERE run_id = ? AND assumption_key IN ('wacc','run.wacc') ORDER BY assumption_key")
    .get(runId) as { assumption_key: string; value: number } | undefined;
  return input
    ? {
        value: input.value,
        source: "run_input",
        assumption_id: null,
        run_id: runId,
        as_of: null,
        rationale: `Resolved from ${input.assumption_key} run_input.`,
        anchor_ref: null,
      }
    : null;
}

export function recordWaccSession(
  db: Database,
  opts: {
    projectId: string;
    wacc: number;
    hurdleIrr?: number | null;
    mode?: string | null;
    rationale?: string | null;
    anchorRef?: string | null;
    asOf?: string | null;
    /** CAPM components (ADR-0115) — persisted on the same run under `wacc.<name>` rows. */
    components?: WaccComponentInput[];
    /**
     * ADR-0156: stamp the session's run with the shortlisted target's company
     * (per-target scope). Omitted/null = project-level — the fs-gate figure.
     */
    subjectCompanyId?: string | null;
    actor: string;
    now?: string;
  },
): WaccSessionResult {
  assertRate("wacc", opts.wacc);
  if (opts.hurdleIrr !== undefined && opts.hurdleIrr !== null) assertRate("hurdle_irr", opts.hurdleIrr);
  for (const comp of opts.components ?? []) validateComponentInput(comp);
  const now = opts.now ?? new Date().toISOString();
  const asOf = opts.asOf?.trim() || now.slice(0, 10);
  const overrides: Record<string, number> = { wacc: opts.wacc };
  if (opts.hurdleIrr !== undefined && opts.hurdleIrr !== null) overrides.hurdle_irr = opts.hurdleIrr;
  const label = `WACC input session${opts.mode ? ` (${opts.mode})` : ""}`;
  const rationale = [opts.rationale?.trim(), opts.mode ? `mode=${opts.mode}` : ""].filter(Boolean).join("; ") || null;

  const run = createRun(db, {
    projectId: opts.projectId,
    label,
    createdBy: opts.actor,
    overrides,
    now,
  });
  // ADR-0156: stamp the per-target scope AFTER createRun — createRun's
  // signature and every other run creator stay untouched.
  if (opts.subjectCompanyId) {
    db.run("UPDATE run SET subject_company_id = ? WHERE id = ?", [opts.subjectCompanyId, run.run_id]);
  }
  recordAssumption(db, {
    runId: run.run_id,
    assumptionKey: "wacc",
    kind: "user",
    value: opts.wacc,
    asOf,
    rationale: rationale ?? undefined,
    anchorRef: opts.anchorRef,
    actor: opts.actor,
    now,
  });
  const hurdle = opts.hurdleIrr !== undefined && opts.hurdleIrr !== null
    ? recordAssumption(db, {
        runId: run.run_id,
        assumptionKey: "hurdle_irr",
        kind: "user",
        value: opts.hurdleIrr,
        asOf,
        rationale: rationale ?? undefined,
        anchorRef: opts.anchorRef,
        actor: opts.actor,
        now,
      })
    : null;
  for (const comp of opts.components ?? []) {
    recordAssumption(db, {
      runId: run.run_id,
      assumptionKey: comp.key,
      kind: comp.kind,
      value: comp.value,
      asOf: comp.asOf?.trim() || asOf,
      rationale: [comp.sourceLabel?.trim(), comp.rationale?.trim()].filter(Boolean).join(" — ") || undefined,
      anchorRef: comp.anchorRef ?? undefined,
      actor: opts.actor,
      now,
    });
  }
  const scope: WaccScope = { subjectCompanyId: opts.subjectCompanyId ?? null };
  return {
    run_id: run.run_id,
    wacc: resolveProjectWacc(db, opts.projectId, scope),
    hurdle_irr: hurdle ? resolveProjectHurdleIrr(db, opts.projectId, scope) : null,
  };
}

/**
 * Load the CAPM components of the latest session run that recorded any.
 * A later direct-mode session does not hide them — the component layer and
 * the confirmed scalar are versioned independently.
 */
export function loadProjectComponents(db: Database, projectId: string, scope: WaccScope = {}): { runId: string | null; components: WaccComponentRecord[] } {
  const company = scope.subjectCompanyId ?? null;
  const rows = db
    .query(
      `SELECT a.assumption_key AS key, a.kind, a.value, a.rationale, a.anchor_ref, a.as_of, a.run_id
       FROM assumption a JOIN run r ON r.id = a.run_id
       WHERE r.project_id = ?
         AND r.subject_company_id IS ?
         AND a.assumption_key LIKE 'wacc.%'
         AND a.run_id = (
           SELECT a2.run_id FROM assumption a2 JOIN run r2 ON r2.id = a2.run_id
           WHERE r2.project_id = ? AND r2.subject_company_id IS ? AND a2.assumption_key LIKE 'wacc.%'
           ORDER BY r2.created_at DESC, r2.id DESC
           LIMIT 1
         )
       ORDER BY a.assumption_key`,
    )
    .all(projectId, company, projectId, company) as WaccComponentRecord[];
  return { runId: rows[0]?.run_id ?? null, components: rows };
}

/**
 * Shortlisted targets of the project's source opportunity with their resolved
 * md_company id (dart_corp_code first, name_ko fallback — the ADR-0143 rule).
 * Drives the analysis target selector on the WACC and financial-analysis
 * pages (ADR-0156). `isBound` marks the target whose company is the project's
 * ADR-0116 subject binding.
 */
export function listProjectAnalysisTargets(db: Database, projectId: string): Array<{ targetId: string; name: string; companyId: string | null; isBound: boolean }> {
  const project = db
    .query("SELECT company_id, source_opportunity_id FROM md_project WHERE id = ?")
    .get(projectId) as { company_id: string | null; source_opportunity_id: string | null } | undefined;
  if (!project) return [];
  const rows = db
    .query(
      `SELECT bt.id, bt.company_name, bt.dart_corp_code,
         (SELECT mc.id FROM md_company mc WHERE bt.dart_corp_code IS NOT NULL AND mc.dart_corp_code = bt.dart_corp_code LIMIT 1) AS company_id,
         (SELECT mc2.id FROM md_company mc2 WHERE mc2.name_ko = bt.company_name LIMIT 1) AS company_id_by_name
       FROM brownfield_target bt
       WHERE bt.opportunity_id = ? AND bt.status = 'shortlisted'
       ORDER BY bt.rank IS NULL, bt.rank, bt.created_at`,
    )
    .all(project.source_opportunity_id ?? "") as Array<{
    id: string;
    company_name: string; dart_corp_code: string | null; company_id: string | null; company_id_by_name: string | null;
  }>;
  return rows.map((row) => {
    const companyId = row.company_id ?? row.company_id_by_name ?? null;
    return { targetId: row.id, name: row.company_name, companyId, isBound: project.company_id != null && companyId === project.company_id };
  });
}
