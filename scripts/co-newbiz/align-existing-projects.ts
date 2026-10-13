// @version 1.0.0
// co-newbiz existing-project data alignment (2026-10-14).
//
// Projects that progressed before the 2026-10 model changes (ADR-0159..0167,
// migrations 0135..0142) can be left inconsistent with the current model.
// This script inventories those gaps per project and, only with --apply,
// performs the DETERMINISTIC subset. Items that need a person's judgement are
// reported (class "human") and never written.
//
// Usage:
//   bun scripts/co-newbiz/align-existing-projects.ts --db <path> [--dry-run]
//   bun scripts/co-newbiz/align-existing-projects.ts --db <path> --apply
//   bun scripts/co-newbiz/align-existing-projects.ts --db <path> --apply --i-know-this-is-a-live-db
//
// Safety:
//   - --db is REQUIRED (no default).
//   - Paths under <repo>/db/data/ and paths inside a docker volume are refused
//     unless BOTH --apply and --i-know-this-is-a-live-db are passed.
//   - Default mode is --dry-run (read-only connection, no change of any kind).
//   - --apply takes a VACUUM INTO backup beside the DB, runs every change in ONE
//     transaction, writes one audit_log row per change (actor
//     'system:data-alignment', action 'data_alignment.<item>') and verifies
//     integrity + row counts afterwards. A second run is a no-op.
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ACTOR = "system:data-alignment";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export type ItemClass = "deterministic" | "human" | "none";

export interface Finding {
  project_id: string;
  project_no: string;
  track: string | null;
  item: string;
  current: string;
  proposed: string;
  class: ItemClass;
  reason: string;
  /** Present only on deterministic findings: the write to perform. */
  change?: { sql: string; params: (string | number | null)[]; table: string; key: string };
}

const GREENFIELD_SUB_TRACKS = new Set(["existing_business_rbd", "intra_venture"]);
const VALID_ORIGINS = new Set(["internal", "external", "hybrid", "joint"]);

// policy_doc_id -> [file holding its current version, pattern]
const POLICY_VERSION_FILES: Record<string, string> = {
  "ovl-greenfield-workspace-scope": "checklists/_overlays/greenfield-workspace-scope.yaml",
  "ovl-brownfield-workspace-scope": "checklists/_overlays/brownfield-workspace-scope.yaml",
  "shared-greenfield-dd": "procedures/_shared/greenfield-dd/schema.yaml",
};

// ---------------------------------------------------------------- path guard

export function isLiveDbPath(dbPath: string): boolean {
  const abs = resolve(dbPath);
  let real = abs;
  try {
    real = realpathSync(abs);
  } catch {
    /* file may not exist yet */
  }
  const liveDir = join(REPO_ROOT, "db", "data");
  const inLiveDir = (p: string) => p === liveDir || p.startsWith(liveDir + "/");
  const dockerVolume = (p: string) => /\/docker\/volumes\/|\/var\/lib\/docker\//.test(p);
  return inLiveDir(abs) || inLiveDir(real) || dockerVolume(abs) || dockerVolume(real);
}

export function assertSafePath(dbPath: string, opts: { apply: boolean; liveAck: boolean }): void {
  if (!isLiveDbPath(dbPath)) return;
  if (opts.apply && opts.liveAck) return;
  throw new Error(
    `Refusing live/volume DB path ${dbPath}: it is inside db/data/ or a docker volume. ` +
      `Work on a copy, or pass BOTH --apply and --i-know-this-is-a-live-db after human approval.`,
  );
}

// ------------------------------------------------------------------ helpers

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}
function columnExists(db: Database, table: string, col: string): boolean {
  if (!tableExists(db, table)) return false;
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
}
function fileVersion(rel: string): string | null {
  const p = join(REPO_ROOT, rel);
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf8").match(/^version:\s*"?([0-9][^"\s]*)"?/m);
  return m ? m[1] : null;
}
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "NULL" : String(v));

interface ProjectRow {
  id: string;
  project_no: string;
  track: string | null;
  origin: string | null;
  source_opportunity_id: string | null;
  deleted_at: string | null;
  wacc_subject?: string | null;
  establishment_mode?: string | null;
}

// --------------------------------------------------------------------- plan

export function buildPlan(db: Database): Finding[] {
  const out: Finding[] = [];
  const hasMode = columnExists(db, "md_project", "establishment_mode");
  const hasWacc = columnExists(db, "md_project", "wacc_subject");
  const projects = db
    .query(
      `SELECT id, project_no, track, origin, source_opportunity_id, deleted_at
              ${hasWacc ? ", wacc_subject" : ""} ${hasMode ? ", establishment_mode" : ""}
         FROM md_project ORDER BY project_no`,
    )
    .all() as ProjectRow[];

  const currentRoute = (p: ProjectRow): { sub_track: string | null } | null =>
    p.source_opportunity_id && tableExists(db, "route_decision")
      ? ((db
          .query("SELECT sub_track FROM route_decision WHERE opportunity_id = ? AND is_current = 1")
          .get(p.source_opportunity_id) as { sub_track: string | null } | null) ?? null)
      : null;

  for (const p of projects) {
    const add = (f: Omit<Finding, "project_id" | "project_no" | "track">) =>
      out.push({ project_id: p.id, project_no: p.project_no, track: p.track, ...f });
    if (p.deleted_at) {
      add({
        item: "soft_deleted_project",
        current: `deleted_at=${p.deleted_at}`,
        proposed: "no change",
        class: "none",
        reason: "Soft-deleted project; excluded from alignment.",
      });
      continue;
    }
    const route = currentRoute(p);
    const greenfield = p.track === "greenfield";
    let effOrigin = p.origin && p.origin !== "" ? p.origin : null;

    // 1. origin (ADR-0166)
    if (greenfield && effOrigin === null) {
      const sub = route?.sub_track ?? null;
      if (sub !== null && !GREENFIELD_SUB_TRACKS.has(sub)) {
        add({
          item: "origin_greenfield_internal",
          current: "origin=NULL",
          proposed: "needs decision",
          class: "human",
          reason: `Current route sub-track '${sub}' is not a Green Field sub-track; origin cannot be derived.`,
        });
      } else {
        add({
          item: "origin_greenfield_internal",
          current: "origin=NULL",
          proposed: "origin=internal",
          class: "deterministic",
          reason: "ADR-0166 default for every Green Field sub-track (including none). Adds the S11 establishment requirement.",
          change: { sql: "UPDATE md_project SET origin = 'internal' WHERE id = ? AND (origin IS NULL OR origin = '')", params: [p.id], table: "md_project", key: p.id },
        });
        effOrigin = "internal";
      }
    } else if (effOrigin !== null && !VALID_ORIGINS.has(effOrigin)) {
      add({
        item: "origin_nonstandard_value",
        current: `origin=${effOrigin}`,
        proposed: "needs decision",
        class: "human",
        reason: "Origin is not one of internal/external/hybrid/joint; derivation predicates will not match it.",
      });
    }

    // 2. greenfield without a current route (sub-track UNASSESSED, fail-closed)
    if (greenfield && !route) {
      add({
        item: "greenfield_no_current_route",
        current: "no current route_decision",
        proposed: "needs decision",
        class: "human",
        reason: "project.sub_track resolves UNASSESSED; DD scope and site steps stay fail-closed until a route is decided.",
      });
    }

    // 3. establishment steps: project_id backfill and duplicates
    const hasSteps = tableExists(db, "entity_establishment_step");
    let stepCount = 0;
    if (hasSteps && p.source_opportunity_id) {
      const orphan = db
        .query("SELECT COUNT(*) c FROM entity_establishment_step WHERE project_id IS NULL AND opportunity_id = ?")
        .get(p.source_opportunity_id) as { c: number };
      const owners = db
        .query("SELECT COUNT(*) c FROM md_project WHERE source_opportunity_id = ?")
        .get(p.source_opportunity_id) as { c: number };
      if (orphan.c > 0 && owners.c === 1) {
        add({
          item: "step_rows_project_id",
          current: `${orphan.c} step row(s) keyed by opportunity only`,
          proposed: "set project_id",
          class: "deterministic",
          reason: "Legacy opportunity-keyed rows; exactly one project owns the opportunity.",
          change: {
            sql: "UPDATE entity_establishment_step SET project_id = ? WHERE project_id IS NULL AND opportunity_id = ?",
            params: [p.id, p.source_opportunity_id],
            table: "entity_establishment_step",
            key: p.id,
          },
        });
      } else if (orphan.c > 0) {
        add({
          item: "step_rows_project_id",
          current: `${orphan.c} orphan step row(s)`,
          proposed: "needs decision",
          class: "human",
          reason: "The opportunity maps to more than one project; the owner is ambiguous.",
        });
      }
    }
    if (hasSteps) {
      stepCount = (db
        .query("SELECT COUNT(*) c FROM entity_establishment_step WHERE project_id = ? OR (project_id IS NULL AND opportunity_id = ?)")
        .get(p.id, p.source_opportunity_id ?? "") as { c: number }).c;
      const dups = db
        .query(
          `SELECT step_no, COUNT(*) c, GROUP_CONCAT(status) st FROM entity_establishment_step
            WHERE project_id = ? OR (project_id IS NULL AND opportunity_id = ?) GROUP BY step_no HAVING c > 1`,
        )
        .all(p.id, p.source_opportunity_id ?? "") as { step_no: number; c: number; st: string }[];
      for (const d of dups) {
        add({
          item: "duplicate_step_rows",
          current: `step ${d.step_no}: ${d.c} rows (${d.st})`,
          proposed: "needs decision",
          class: "human",
          reason: "Assignee bug 2026-10-13 created a second row for the same step; deleting a row is a data decision and history events may reference it.",
        });
      }
    }

    // 4. establishment mode (ADR-0167)
    const originOk = effOrigin === "internal" || effOrigin === "joint";
    if (!hasMode) {
      if (greenfield || stepCount > 0) {
        add({
          item: "establishment_mode",
          current: "column absent (migration 0142 not applied)",
          proposed: "apply migration 0142 first",
          class: "none",
          reason: "Migration 0142 adds the column and backfills origin internal/joint to new_entity.",
        });
      }
    } else if ((p.establishment_mode ?? null) === null && originOk) {
      if (stepCount > 0) {
        add({
          item: "establishment_mode_new_entity",
          current: "establishment_mode=NULL, recorded establishment steps",
          proposed: "establishment_mode=new_entity",
          class: "deterministic",
          reason: "Steps recorded before the mode existed are entity steps (ADR-0167 D4).",
          change: {
            sql: "UPDATE md_project SET establishment_mode = 'new_entity' WHERE id = ? AND establishment_mode IS NULL",
            params: [p.id],
            table: "md_project",
            key: p.id,
          },
        });
      } else if (greenfield) {
        add({
          item: "establishment_mode_choice",
          current: "establishment_mode=NULL, no steps",
          proposed: "needs decision",
          class: "human",
          reason: "ADR-0167 D4: no default; a person chooses new_entity or business_unit at S10.",
        });
      }
    }

    // 5. site_required confirmation (ADR-0160)
    if (greenfield && route?.sub_track && GREENFIELD_SUB_TRACKS.has(route.sub_track) && tableExists(db, "dimension_input")) {
      const live = db
        .query("SELECT 1 FROM dimension_input WHERE project_id = ? AND var_key = 'project.site_required' AND superseded_by IS NULL")
        .get(p.id);
      if (!live) {
        add({
          item: "site_required_unconfirmed",
          current: "no live project.site_required assertion",
          proposed: "needs decision",
          class: "human",
          reason: `Sub-track '${route.sub_track}' has no site default; a person must confirm whether a site is needed.`,
        });
      }
    }

    // 6. business goals (ADR-0159)
    if (tableExists(db, "project_business_goal") && tableExists(db, "process_run")) {
      const s8 = db
        .query("SELECT 1 FROM process_run WHERE project_id = ? AND stage LIKE 's8%' LIMIT 1")
        .get(p.id);
      const goals = db
        .query("SELECT COUNT(*) c FROM project_business_goal WHERE project_id = ? AND superseded_at IS NULL AND retired_at IS NULL")
        .get(p.id) as { c: number };
      if (s8 && goals.c === 0) {
        add({
          item: "business_goals_missing",
          current: "0 active project goals",
          proposed: "needs decision",
          class: "human",
          reason: "Goals are analyst-set per deal; target resolution falls back to affiliate/group standards meanwhile.",
        });
      }
    }

    // 7. WACC subject (per-target WACC sessions)
    if (hasWacc && (p.wacc_subject ?? null) === null && tableExists(db, "process_run")) {
      const s8 = db.query("SELECT 1 FROM process_run WHERE project_id = ? AND stage LIKE 's8%' LIMIT 1").get(p.id);
      if (s8) {
        add({
          item: "wacc_subject_unset",
          current: "wacc_subject=NULL",
          proposed: "needs decision",
          class: "human",
          reason: "promoter / target / project_newco is a valuation-agent judgement with rationale; not derivable.",
        });
      }
    }

    // 8. policy pins versus current policy versions
    if (tableExists(db, "project_policy_pin")) {
      const pins = db
        .query("SELECT policy_doc_id, pinned_version FROM project_policy_pin WHERE project_id = ? AND superseded_by IS NULL")
        .all(p.id) as { policy_doc_id: string; pinned_version: string }[];
      for (const pin of pins) {
        const file = POLICY_VERSION_FILES[pin.policy_doc_id];
        const cur = file ? fileVersion(file) : null;
        if (cur && cur !== pin.pinned_version) {
          add({
            item: "policy_pin_stale",
            current: `${pin.policy_doc_id}@${pin.pinned_version}`,
            proposed: `${pin.policy_doc_id}@${cur} (re-pin)`,
            class: "human",
            reason: "A pin is a recorded human opt-in; re-pinning changes the item scope and needs a migration_note.",
          });
        }
      }
    }

    // 9. dd gate decision pinning the pre-scope view (information only)
    if (tableExists(db, "gate_decision")) {
      const dd = db
        .query(
          `SELECT g.decision FROM gate_decision g LEFT JOIN gate_decision_stale s ON s.decision_id = g.id
            WHERE g.entity_type='project' AND g.entity_id = ? AND g.gate='dd' AND s.decision_id IS NULL
            ORDER BY g.decided_at DESC LIMIT 1`,
        )
        .get(p.id) as { decision: string } | null;
      if (dd) {
        add({
          item: "dd_gate_pin",
          current: `valid dd gate decision (${dd.decision})`,
          proposed: "no change",
          class: "none",
          reason: "ADR-0160 (f) / ADR-0162 (c): a recorded dd decision pins the pre-scope S9 view; opt-in pins override.",
        });
      }
    }
  }
  return out;
}

// -------------------------------------------------------------------- apply

const COUNT_TABLES = [
  "md_project",
  "entity_establishment_step",
  "entity_establishment_step_event",
  "project_policy_pin",
  "route_decision",
  "gate_decision",
  "project_business_goal",
  "venture_scorecard",
];

export function rowCounts(db: Database): Record<string, number> {
  const r: Record<string, number> = {};
  for (const t of COUNT_TABLES) if (tableExists(db, t)) r[t] = (db.query(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
  return r;
}

function ulid(): string {
  const t = Date.now().toString(36).toUpperCase().padStart(10, "0");
  let rnd = "";
  for (let i = 0; i < 16; i++) rnd += "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Math.floor(Math.random() * 32)];
  return t + rnd;
}

export interface ApplyResult {
  applied: number;
  backup: string | null;
  before: Record<string, number>;
  after: Record<string, number>;
  integrity: string;
}

export function applyPlan(dbPath: string, now: string = new Date().toISOString()): ApplyResult {
  const db = new Database(dbPath);
  db.run("PRAGMA foreign_keys = ON");
  try {
    const plan = buildPlan(db).filter((f) => f.class === "deterministic" && f.change);
    const before = rowCounts(db);
    if (plan.length === 0) return { applied: 0, backup: null, before, after: before, integrity: "ok (no change)" };

    const backup = `${dbPath}.align-backup-${now.replace(/[:.]/g, "-")}.sqlite`;
    db.run(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);

    let applied = 0;
    db.transaction(() => {
      for (const f of plan) {
        const res = db.run(f.change!.sql, f.change!.params);
        if (res.changes === 0) continue;
        applied++;
        db.run("INSERT INTO audit_log (id, actor_user_id, action, target, created_at) VALUES (?, ?, ?, ?, ?)", [
          ulid(),
          ACTOR,
          `data_alignment.${f.item}`,
          `${f.project_id}#before=${f.current};after=${f.proposed}`,
          now,
        ]);
      }
    })();

    const after = rowCounts(db);
    const integrity = (db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    const fk = db.query("PRAGMA foreign_key_check").all();
    for (const t of Object.keys(before)) if (before[t] !== after[t]) throw new Error(`Row count changed for ${t}: ${before[t]} -> ${after[t]}`);
    if (integrity !== "ok" || fk.length > 0) throw new Error(`Post-apply verification failed: integrity=${integrity}, fk violations=${fk.length}. Restore from ${backup}.`);
    return { applied, backup, before, after, integrity };
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------------- report

export function formatReport(plan: Finding[]): string {
  const lines = ["project_no | track | item | current | proposed | class | reason", "-".repeat(60)];
  for (const f of plan) lines.push([f.project_no, show(f.track), f.item, f.current, f.proposed, f.class, f.reason].join(" | "));
  const c = (k: ItemClass) => plan.filter((f) => f.class === k).length;
  lines.push("", `deterministic=${c("deterministic")} human=${c("human")} none=${c("none")}`);
  return lines.join("\n");
}

// --------------------------------------------------------------------- main

function main(argv: string[]): number {
  const i = argv.indexOf("--db");
  const dbPath = i >= 0 ? argv[i + 1] : undefined;
  if (!dbPath || dbPath.startsWith("--")) {
    console.error("error: --db <path> is required (no default).");
    return 2;
  }
  const apply = argv.includes("--apply");
  const liveAck = argv.includes("--i-know-this-is-a-live-db");
  try {
    assertSafePath(dbPath, { apply, liveAck });
    if (!existsSync(dbPath)) throw new Error(`DB file not found: ${dbPath}`);
    const ro = new Database(dbPath, { readonly: true });
    const plan = buildPlan(ro);
    ro.close();
    console.log(formatReport(plan));
    if (!apply) {
      console.log("\nmode: dry-run (no change made). Pass --apply to perform the deterministic changes only.");
      return 0;
    }
    const r = applyPlan(dbPath);
    console.log(`\napplied=${r.applied} backup=${r.backup ?? "none"} integrity=${r.integrity}`);
    console.log("row counts before:", JSON.stringify(r.before));
    console.log("row counts after: ", JSON.stringify(r.after));
    return 0;
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
