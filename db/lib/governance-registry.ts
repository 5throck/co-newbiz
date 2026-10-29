/**
 * governance-registry.ts — the `governance_doc` registry: manifest contract,
 * idempotent sync, review-due computation and the enriched admin view.
 *
 * The repo files (policies/, procedures/, checklists/, templates/) are the
 * source of truth; `scripts/co-newbiz/governance-sync.ts` scans them into a
 * committed manifest (docs/governance/governance-registry.generated.json).
 * THIS module consumes that manifest and upserts the DB, so the same code runs
 * from the CLI, the admin "sync now" button and the scheduler — none of which
 * need the repo tree at run time (the web bundle ships the manifest only).
 *
 * Lifecycle (the same append-mostly pattern as policy:sync):
 *   - unknown (layer, key)      -> INSERT
 *   - version changed           -> INSERT a new row, old row.superseded_by = new id
 *   - same version, other metadata changed -> UPDATE in place (no row is created)
 *   - otherwise                 -> unchanged
 * Rows are NEVER deleted: waivers (waiver.governance_doc_id) and rag_rule.policy_id
 * reference them. Documents that disappear from the repo are reported as orphans.
 */

import type { Database } from "bun:sqlite";
import { appendAudit } from "./access-control.ts";
import { ulid } from "./ulid.ts";

export const GOVERNANCE_LAYERS = ["policy", "procedure", "guideline", "checklist", "template"] as const;
export type GovernanceLayer = (typeof GOVERNANCE_LAYERS)[number];
export type Enforceability = "mandatory" | "recommended" | "mixed";

/** Repo roots the manifest covers; used to recognise orphaned registry rows. */
export const GOVERNANCE_ROOTS = ["policies/", "procedures/", "checklists/", "guidelines/", "templates/"] as const;

export interface ManifestDoc {
  id: string;
  layer: GovernanceLayer;
  key: string;
  title: string;
  scope: "shared" | "entity" | "region";
  entity_code: string | null;
  region_code: string | null;
  version: string;
  enforceability: Enforceability;
  owner_agent: string;
  doc_path: string;
  /** null when the file declares none — stored as '' (never invented). */
  effective_from: string | null;
  review_cycle_months: number | null;
}

export interface ManifestFinding {
  path: string;
  layer: GovernanceLayer;
  /** error: not registered (a required field is missing); warn: registered, optional field missing/derived. */
  severity: "error" | "warn";
  missing: string[];
}

export interface GovernanceManifest {
  schema: 1;
  generated_by: string;
  counts: { docs: number; findings_error: number; findings_warn: number; by_layer: Record<string, number> };
  docs: ManifestDoc[];
  findings: ManifestFinding[];
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type SyncAction = "inserted" | "superseded" | "updated" | "unchanged";

export interface SyncDocResult {
  layer: GovernanceLayer;
  key: string;
  action: SyncAction;
  id: string;
  fromVersion?: string;
  toVersion: string;
}

export interface GovernanceSyncResult {
  dryRun: boolean;
  inserted: number;
  superseded: number;
  updated: number;
  unchanged: number;
  docs: SyncDocResult[];
  /** Active registry rows from scanned roots that no longer exist in the manifest (kept, never deleted). */
  orphans: Array<{ id: string; layer: string; key: string; doc_path: string }>;
  findings: ManifestFinding[];
}

interface ExistingRow {
  id: string;
  version: string;
  title: string;
  scope: string;
  region_code: string | null;
  enforceability: string;
  owner_agent: string;
  doc_path: string;
  effective_from: string;
  review_cycle_months: number | null;
}

function lookupActive(db: Database, layer: string, key: string): ExistingRow | undefined {
  return db
    .query(
      `SELECT id, version, title, scope, region_code, enforceability, owner_agent, doc_path, effective_from, review_cycle_months
       FROM governance_doc WHERE layer = ? AND key = ? AND superseded_by IS NULL
       ORDER BY effective_from DESC, id LIMIT 1`,
    )
    .get(layer, key) as ExistingRow | undefined;
}

function idTaken(db: Database, id: string): boolean {
  return db.query("SELECT 1 FROM governance_doc WHERE id = ?").get(id) !== null;
}

function entityIdFor(db: Database, code: string | null): string | null {
  if (!code) return null;
  return (db.query("SELECT id FROM md_entity WHERE entity_code = ?").get(code) as { id: string } | null)?.id ?? null;
}

function metadataDiffers(row: ExistingRow, d: ManifestDoc): boolean {
  return (
    row.title !== d.title ||
    row.scope !== d.scope ||
    (row.region_code ?? null) !== d.region_code ||
    row.enforceability !== d.enforceability ||
    row.owner_agent !== d.owner_agent ||
    row.doc_path !== d.doc_path ||
    row.effective_from !== (d.effective_from ?? "") ||
    (row.review_cycle_months ?? null) !== d.review_cycle_months
  );
}

export interface ApplyOptions {
  dryRun?: boolean;
  /** audit_log.actor_user_id — a user id for the admin button, a job/CLI name otherwise. */
  actor: string;
  via: "cli" | "admin" | "scheduler";
  now: string;
}

/**
 * Apply a manifest to governance_doc. One transaction; a dry run computes the
 * identical plan but writes nothing (and writes no audit row).
 */
export function applyGovernanceManifest(db: Database, manifest: GovernanceManifest, options: ApplyOptions): GovernanceSyncResult {
  const dryRun = options.dryRun === true;
  const result: GovernanceSyncResult = {
    dryRun,
    inserted: 0,
    superseded: 0,
    updated: 0,
    unchanged: 0,
    docs: [],
    orphans: [],
    findings: manifest.findings,
  };

  const work = () => {
    for (const doc of manifest.docs) {
      const existing = lookupActive(db, doc.layer, doc.key);
      const entityId = doc.scope === "entity" ? entityIdFor(db, doc.entity_code) : null;
      const insertRow = (id: string) => {
        if (dryRun) return;
        db.run(
          `INSERT INTO governance_doc (id, layer, key, title, scope, entity_id, region_code, version, enforceability, owner_agent, doc_path, effective_from, superseded_by, review_cycle_months)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`,
          [id, doc.layer, doc.key, doc.title, doc.scope, entityId, doc.region_code, doc.version, doc.enforceability, doc.owner_agent, doc.doc_path, doc.effective_from ?? "", doc.review_cycle_months],
        );
      };
      const freshId = (): string => {
        let id = `${doc.id}@${doc.version}`;
        if (idTaken(db, id)) id = `${id}#${ulid().slice(-6).toLowerCase()}`;
        return id;
      };

      if (!existing) {
        // First registration uses the stable id (waivers anchor on it).
        const id = idTaken(db, doc.id) ? freshId() : doc.id;
        insertRow(id);
        result.inserted++;
        result.docs.push({ layer: doc.layer, key: doc.key, action: "inserted", id, toVersion: doc.version });
      } else if (existing.version !== doc.version) {
        const id = freshId();
        insertRow(id);
        if (!dryRun) db.run("UPDATE governance_doc SET superseded_by = ? WHERE id = ?", [id, existing.id]);
        result.superseded++;
        result.docs.push({ layer: doc.layer, key: doc.key, action: "superseded", id, fromVersion: existing.version, toVersion: doc.version });
      } else if (metadataDiffers(existing, doc)) {
        if (!dryRun) {
          db.run(
            "UPDATE governance_doc SET title = ?, scope = ?, entity_id = ?, region_code = ?, enforceability = ?, owner_agent = ?, doc_path = ?, effective_from = ?, review_cycle_months = ? WHERE id = ?",
            [doc.title, doc.scope, entityId, doc.region_code, doc.enforceability, doc.owner_agent, doc.doc_path, doc.effective_from ?? "", doc.review_cycle_months, existing.id],
          );
        }
        result.updated++;
        result.docs.push({ layer: doc.layer, key: doc.key, action: "updated", id: existing.id, toVersion: doc.version });
      } else {
        result.unchanged++;
        result.docs.push({ layer: doc.layer, key: doc.key, action: "unchanged", id: existing.id, toVersion: doc.version });
      }
    }

    const inManifest = new Set(manifest.docs.map((d) => `${d.layer}\u0000${d.key}`));
    const active = db
      .query("SELECT id, layer, key, doc_path FROM governance_doc WHERE superseded_by IS NULL ORDER BY layer, key")
      .all() as Array<{ id: string; layer: string; key: string; doc_path: string }>;
    for (const row of active) {
      if (GOVERNANCE_ROOTS.some((r) => row.doc_path.startsWith(r)) && !inManifest.has(`${row.layer}\u0000${row.key}`)) {
        result.orphans.push(row);
      }
    }

    if (!dryRun) {
      appendAudit(db, {
        actor: options.actor,
        action: "governance_sync",
        target: `via=${options.via};inserted=${result.inserted};superseded=${result.superseded};updated=${result.updated};unchanged=${result.unchanged};orphans=${result.orphans.length};findings=${manifest.findings.length}`,
        now: options.now,
      });
    }
  };

  if (dryRun) work();
  else db.transaction(work)();
  return result;
}

// ---------------------------------------------------------------------------
// Review due
// ---------------------------------------------------------------------------

export type ReviewStatus = "none" | "ok" | "due_soon" | "overdue";

export interface ReviewDue {
  next_review: string | null;
  status: ReviewStatus;
  /** Whole days until next_review (negative when overdue); null when not applicable. */
  days_left: number | null;
}

export const REVIEW_SOON_DAYS = 30;

function addMonthsYmd(ymd: string, months: number): string | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const total = mo + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

/** next review = effective_from + review_cycle_months; `today` is a YYYY-MM-DD string (no clock reads here). */
export function computeReviewDue(
  doc: { effective_from: string | null | undefined; review_cycle_months: number | null | undefined; superseded_by?: string | null },
  today: string,
): ReviewDue {
  const none: ReviewDue = { next_review: null, status: "none", days_left: null };
  if (doc.superseded_by) return none;
  const from = (doc.effective_from ?? "").slice(0, 10);
  const cycle = doc.review_cycle_months;
  if (!from || !cycle || cycle <= 0) return none;
  const next = addMonthsYmd(from, cycle);
  if (!next || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return none;
  const days = Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const status: ReviewStatus = days < 0 ? "overdue" : days <= REVIEW_SOON_DAYS ? "due_soon" : "ok";
  return { next_review: next, status, days_left: days };
}

// ---------------------------------------------------------------------------
// Admin view
// ---------------------------------------------------------------------------

export interface GovernanceViewRow {
  id: string;
  layer: string;
  key: string;
  title: string;
  scope: string;
  version: string;
  enforceability: string;
  owner_agent: string;
  doc_path: string;
  effective_from: string;
  superseded_by: string | null;
  review_cycle_months: number | null;
  next_review: string | null;
  review_status: ReviewStatus;
  days_to_review: number | null;
  active_waivers: number;
  waiver_clauses: Array<{ clause_ref: string; count: number }>;
  /** FR-GOV-11: >= 3 active waivers on one clause. */
  waiver_concentrated: boolean;
  library_id: string | null;
}

export const WAIVER_CONCENTRATION_THRESHOLD = 3;

/**
 * Registry rows plus review-due, waiver concentration and the docs-hub link.
 * Waivers are rolled up per (layer, key) so a superseded version's waivers
 * stay visible on the current row. `libraryIndex` maps doc_path -> library id
 * (the web layer owns that projection; this module stays DB-only).
 */
export function listGovernanceView(db: Database, options: { now: string; libraryIndex?: ReadonlyMap<string, string> }): GovernanceViewRow[] {
  const today = options.now.slice(0, 10);
  const rows = db
    .query(
      `SELECT id, layer, key, title, scope, version, enforceability, owner_agent, doc_path, effective_from, superseded_by, review_cycle_months
       FROM governance_doc ORDER BY layer, key, effective_from DESC, id`,
    )
    .all() as Array<Omit<GovernanceViewRow, "next_review" | "review_status" | "days_to_review" | "active_waivers" | "waiver_clauses" | "waiver_concentrated" | "library_id">>;

  const waiverRows = db
    .query(
      `SELECT g.layer AS layer, g.key AS key, w.clause_ref AS clause_ref, COUNT(*) AS count
       FROM waiver w JOIN governance_doc g ON g.id = w.governance_doc_id
       WHERE w.status = 'active' AND w.approved_at IS NOT NULL AND w.expires_at > ?
       GROUP BY g.layer, g.key, w.clause_ref ORDER BY count DESC, w.clause_ref`,
    )
    .all(options.now) as Array<{ layer: string; key: string; clause_ref: string; count: number }>;
  const byDoc = new Map<string, Array<{ clause_ref: string; count: number }>>();
  for (const w of waiverRows) {
    const k = `${w.layer}\u0000${w.key}`;
    const list = byDoc.get(k) ?? [];
    list.push({ clause_ref: w.clause_ref, count: w.count });
    byDoc.set(k, list);
  }

  return rows.map((r) => {
    const due = computeReviewDue(r, today);
    // Waivers belong to the document lineage, shown on the current version only.
    const clauses = r.superseded_by ? [] : byDoc.get(`${r.layer}\u0000${r.key}`) ?? [];
    return {
      ...r,
      next_review: due.next_review,
      review_status: due.status,
      days_to_review: due.days_left,
      active_waivers: clauses.reduce((n, c) => n + c.count, 0),
      waiver_clauses: clauses.slice(0, 5),
      waiver_concentrated: clauses.some((c) => c.count >= WAIVER_CONCENTRATION_THRESHOLD),
      library_id: options.libraryIndex?.get(r.doc_path) ?? null,
    };
  });
}
