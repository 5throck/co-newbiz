// @version 1.1.0
// Gate-integrity shadow review report (ADR-0186 P5, runbook docs/runbooks/gate-integrity-enforce-flip.md). READ-ONLY.
//
// Summarises, over a window, the audit rows the gate-integrity families write while in `shadow`:
//   gate_integrity.would_block:<code>   a request that WOULD have been refused under enforce (and proceeded)
//   <scope>.refused:<code>              a request that WAS refused on a human-role route
// grouped by family / code / day / entity, plus the readiness numbers the flip preconditions need:
//   - active human-role grant holders per role (O-1: at least two for maker/checker)
//   - legacy unconfirmed mandatory `na` rows (waiver family precondition)
//   - open brownfield projects past fs that miss an applicable core validator (validators family)
//   - open projects with an S8 business case whose WACC is still provisional (wacc family)
// The database is opened read-only. Nothing is written, no audit row is appended.
//
// Usage:
//   bun scripts/co-newbiz/gate-integrity-shadow-report.ts [--days 14] [--from <iso>] [--to <iso>] [--json] [--db-path <path>]
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GATE_INTEGRITY_FAMILIES, gateIntegrityMode, type GateIntegrityFamily } from "../../db/lib/gate-integrity-flags.ts";
import { evaluateValidatorCompleteness } from "../../db/lib/validator-completeness.ts";
import { resolveWaccConfirmation } from "../../db/lib/wacc-confirmation.ts";
import { readdirSync } from "node:fs";
import { isMandatoryChecklistItem } from "../../app/web-next/lib/dd-checklist-tailor.ts";

/** Which family owns each refusal code (the enforce-flip order is per family). */
export const CODE_FAMILY: Record<string, GateIntegrityFamily | "infrastructure" | "other"> = {
  rationale_insufficient: "rationale",
  snapshot_stale: "snapshot_ack",
  ack_required: "snapshot_ack",
  kill_binding_unoverridden: "kill_binding",
  validators_incomplete: "validators",
  certification_unconfirmed: "validators",
  condition_open: "validators",
  derived_item: "validators",
  wacc_unconfirmed: "wacc",
  ladder_prerequisite_missing: "ladder",
  divergence_reason_required: "divergence",
  checker_must_differ: "maker_checker",
  checker_conflict: "maker_checker",
  human_role_required: "maker_checker",
  grant_revoked: "maker_checker",
  approver_must_differ: "waiver",
  approver_role_invalid: "waiver",
  clause_unresolved: "waiver",
  not_waivable: "waiver",
  waiver_term_too_long: "waiver",
  na_reason_required: "waiver",
  snapshot_error: "infrastructure",
};

/** A schema element a section needs, and the migration that introduces it (gate-integrity range 0173-0179). */
export interface SchemaNeed { table: string; column?: string; migration: string }
export interface MigrationPending { section: string; missing: string[]; migrations: string[] }

export function schemaHas(db: Database, n: SchemaNeed): boolean {
  if (!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(n.table)) return false;
  if (!n.column) return true;
  return (db.query(`PRAGMA table_info(${n.table})`).all() as Array<{ name: string }>).some((c) => c.name === n.column);
}
/** The needs that are not met; empty when the section can be computed. */
export function missingNeeds(db: Database, needs: readonly SchemaNeed[]): SchemaNeed[] {
  return needs.filter((n) => !schemaHas(db, n));
}
export function pendingEntry(section: string, missing: readonly SchemaNeed[]): MigrationPending {
  return { section, missing: missing.map((m) => (m.column ? `${m.table}.${m.column}` : m.table)), migrations: [...new Set(missing.map((m) => m.migration))].sort() };
}
/** Migration files of the gate-integrity range (0173+) that the database has not applied yet (empty when unknowable). */
export function unappliedGateIntegrityMigrations(db: Database): string[] {
  if (!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()) return [];
  try {
    const applied = new Set((db.query("SELECT filename FROM schema_migrations").all() as Array<{ filename: string }>).map((r) => r.filename));
    return readdirSync(join(import.meta.dirname, "../../db/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f >= "0173" && !applied.has(f)).sort();
  } catch { return []; }
}
export const NEED = {
  snapshot: { table: "gate_decision_snapshot", migration: "0173_gate_decision_snapshot" },
  aiColumn: { table: "gate_decision", column: "ai_recommended_decision", migration: "0173_gate_decision_snapshot" },
  grants: { table: "app_user_human_role", migration: "0176_human_role_grant" },
  naConfirm: { table: "project_checklist_item_state", column: "na_confirmed_by", migration: "0177_na_confirmation" },
  conditions: { table: "condition_precedent", migration: "0175_condition_precedent" },
  cutoff: { table: "gate_integrity_cutoff", migration: "0175_condition_precedent" },
  chainDecision: { table: "approval_chain", column: "gate_decision_id", migration: "0175_condition_precedent" },
} as const satisfies Record<string, SchemaNeed>;

export interface ShadowRow { family: string; code: string; kind: "would_block" | "refused"; day: string; entity: string; actor: string; count: number }
export interface ShadowReport {
  generated_at: string;
  window: { from: string; to: string };
  flags: Record<string, string>;
  totals: { would_block: number; refused: number };
  by_family: Array<{ family: string; would_block: number; refused: number; codes: Record<string, number> }>;
  by_day: Array<{ day: string; would_block: number; refused: number }>;
  rows: ShadowRow[];
  /** Sections that could not be computed because the database lacks a gate-integrity migration (status migration_pending). */
  migration_pending: MigrationPending[];
  unapplied_migrations: string[];
  readiness: {
    grant_holders: Record<string, string[]> | null;
    second_grant_holder_ready: boolean | null;
    legacy_unconfirmed_mandatory_na: { rows: number; projects: Array<{ project_id: string; rows: number }> } | null;
    brownfield_missing_validators: Array<{ project_id: string; missing: string[] }> | null;
    s8_provisional_wacc: Array<{ project_id: string; missing: string[] }> | null;
  };
}

function entityOf(target: string): string {
  // would_block targets are `<entityType>:<entityId>:<gate>`; refusals use `<project>:<gate>:<id>` or similar - keep the first two parts.
  return target.split(":").slice(0, 3).join(":");
}

export function buildShadowReport(db: Database, opts: { from: string; to: string; now?: string }): ShadowReport {
  const audits = db
    .query(
      `SELECT actor_user_id AS actor, action, target, substr(created_at, 1, 10) AS day FROM audit_log
       WHERE created_at >= ? AND created_at < ? AND (action LIKE 'gate_integrity.would_block:%' OR action LIKE '%.refused:%') ORDER BY created_at`,
    )
    .all(opts.from, opts.to) as Array<{ actor: string; action: string; target: string; day: string }>;
  const agg = new Map<string, ShadowRow>();
  for (const a of audits) {
    const isWould = a.action.startsWith("gate_integrity.would_block:");
    const code = a.action.slice(a.action.indexOf(":") + 1);
    const family = CODE_FAMILY[code] ?? "other";
    const entity = isWould ? entityOf(a.target) : `${a.action.slice(0, a.action.indexOf(".refused"))}:${entityOf(a.target)}`;
    const key = [isWould ? "w" : "r", family, code, a.day, entity, a.actor].join("|");
    const row = agg.get(key) ?? { family, code, kind: isWould ? "would_block" : "refused", day: a.day, entity, actor: a.actor, count: 0 };
    row.count += 1;
    agg.set(key, row);
  }
  const rows = [...agg.values()].sort((x, y) => (x.day + x.family + x.code + x.entity).localeCompare(y.day + y.family + y.code + y.entity));

  const familyMap = new Map<string, { family: string; would_block: number; refused: number; codes: Record<string, number> }>();
  const dayMap = new Map<string, { day: string; would_block: number; refused: number }>();
  for (const r of rows) {
    const f = familyMap.get(r.family) ?? { family: r.family, would_block: 0, refused: 0, codes: {} };
    f[r.kind] += r.count;
    f.codes[r.code] = (f.codes[r.code] ?? 0) + r.count;
    familyMap.set(r.family, f);
    const d = dayMap.get(r.day) ?? { day: r.day, would_block: 0, refused: 0 };
    d[r.kind] += r.count;
    dayMap.set(r.day, d);
  }

  // ── readiness ──────────────────────────────────────────────────────────────
  const pending: MigrationPending[] = [];
  let holders: Record<string, string[]> | null = null;
  let distinctCount = 0;
  const noGrants = missingNeeds(db, [NEED.grants]);
  if (noGrants.length > 0) pending.push(pendingEntry("readiness.grant_holders", noGrants));
  else {
    const grants = db
      .query(
        `SELECT h.role_key, h.user_id FROM app_user_human_role h JOIN app_user u ON u.user_id = h.user_id
         WHERE h.revoked_at IS NULL AND u.status = 'active' ORDER BY h.role_key, h.user_id`,
      )
      .all() as Array<{ role_key: string; user_id: string }>;
    holders = { "entity-ic-reviewer": [], "group-ic-reviewer": [] };
    for (const g of grants) (holders[g.role_key] ??= []).push(g.user_id);
    distinctCount = new Set(grants.map((g) => g.user_id)).size;
  }

  const openProjects = db.query("SELECT id, track FROM md_project WHERE status = 'open' AND deleted_at IS NULL ORDER BY id").all() as Array<{ id: string; track: string | null }>;
  let naResult: ShadowReport["readiness"]["legacy_unconfirmed_mandatory_na"] = null;
  const noNa = missingNeeds(db, [NEED.naConfirm]);
  if (noNa.length > 0) pending.push(pendingEntry("readiness.legacy_unconfirmed_mandatory_na", noNa));
  else {
    const naRows = db
      .query(
        `SELECT s.project_id, s.checklist_id, s.item_id FROM project_checklist_item_state s JOIN md_project p ON p.id = s.project_id
         WHERE s.status = 'na' AND s.na_confirmed_by IS NULL AND p.deleted_at IS NULL`,
      )
      .all() as Array<{ project_id: string; checklist_id: string; item_id: string }>;
    const naByProject = new Map<string, number>();
    for (const r of naRows) if (isMandatoryChecklistItem(r.checklist_id, r.item_id)) naByProject.set(r.project_id, (naByProject.get(r.project_id) ?? 0) + 1);
    naResult = { rows: [...naByProject.values()].reduce((a, b) => a + b, 0), projects: [...naByProject].map(([project_id, rows]) => ({ project_id, rows })).sort((a, b) => a.project_id.localeCompare(b.project_id)) };
  }

  let missingValidators: ShadowReport["readiness"]["brownfield_missing_validators"] = [];
  let provisional: ShadowReport["readiness"]["s8_provisional_wacc"] = [];
  try {
    const hasFs = db.prepare("SELECT 1 FROM gate_decision WHERE entity_type = 'project' AND entity_id = ? AND gate = 'fs' AND decision = 'go' LIMIT 1");
    const hasCase = db.prepare("SELECT 1 FROM business_case_model WHERE project_id = ? LIMIT 1");
    for (const p of openProjects) {
      if (p.track === "brownfield" && hasFs.get(p.id)) {
        try {
          const v = evaluateValidatorCompleteness(p.id, null, db);
          if (v.halt.missing.length > 0) missingValidators.push({ project_id: p.id, missing: [...v.halt.missing] });
        } catch { /* a project the engine cannot read is not counted */ }
      }
      if (hasCase.get(p.id)) {
        const w = resolveWaccConfirmation(db, p.id);
        if (!w.confirmed) provisional.push({ project_id: p.id, missing: [...w.missing] });
      }
    }
  } catch {
    // an older schema lacks tables these readers need: report the sections as pending, never throw
    pending.push({ section: "readiness.brownfield_missing_validators", missing: ["validator or WACC tables"], migrations: unappliedGateIntegrityMigrations(db) });
    pending.push({ section: "readiness.s8_provisional_wacc", missing: ["validator or WACC tables"], migrations: unappliedGateIntegrityMigrations(db) });
    missingValidators = null as never;
    provisional = null as never;
  }

  const flags: Record<string, string> = {};
  for (const f of GATE_INTEGRITY_FAMILIES) flags[f] = gateIntegrityMode(f);
  const now = opts.now ?? new Date().toISOString();
  return {
    generated_at: now,
    window: { from: opts.from, to: opts.to },
    flags,
    totals: { would_block: rows.filter((r) => r.kind === "would_block").reduce((n, r) => n + r.count, 0), refused: rows.filter((r) => r.kind === "refused").reduce((n, r) => n + r.count, 0) },
    migration_pending: pending,
    unapplied_migrations: unappliedGateIntegrityMigrations(db),
    by_family: [...familyMap.values()].sort((a, b) => a.family.localeCompare(b.family)),
    by_day: [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    rows,
    readiness: {
      grant_holders: holders,
      second_grant_holder_ready: holders === null ? null : distinctCount >= 2,
      legacy_unconfirmed_mandatory_na: naResult,
      brownfield_missing_validators: missingValidators,
      s8_provisional_wacc: provisional,
    },
  };
}

export function renderHuman(r: ShadowReport): string {
  const L: string[] = [];
  L.push(`Gate-integrity shadow report  ${r.window.from.slice(0, 10)} .. ${r.window.to.slice(0, 10)}  (generated ${r.generated_at})`);
  L.push(`Flags (this process environment, not the running server): ${Object.entries(r.flags).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  L.push(`Totals: would_block=${r.totals.would_block}  refused=${r.totals.refused}`);
  L.push("", "By family");
  if (r.by_family.length === 0) L.push("  (no shadow or refusal events in the window)");
  for (const f of r.by_family) L.push(`  ${f.family.padEnd(14)} would_block=${String(f.would_block).padStart(4)} refused=${String(f.refused).padStart(4)}  ${Object.entries(f.codes).map(([c, n]) => `${c}:${n}`).join(", ")}`);
  L.push("", "By day");
  for (const d of r.by_day) L.push(`  ${d.day}  would_block=${d.would_block} refused=${d.refused}`);
  L.push("", "Events (family / code / day / entity / actor / count)");
  for (const x of r.rows) L.push(`  [${x.kind === "would_block" ? "W" : "R"}] ${x.family} / ${x.code} / ${x.day} / ${x.entity} / ${x.actor} x${x.count}`);
  const g = r.readiness;
  const pend = (section: string) => r.migration_pending.find((x) => x.section === section);
  const pendTxt = (section: string) => { const x = pend(section); return x ? `MIGRATION PENDING (${x.migrations.join(", ") || "unknown"})` : null; };
  L.push("", "Readiness");
  L.push(`  Grant holders: ${g.grant_holders ? `entity-ic-reviewer=${g.grant_holders["entity-ic-reviewer"]?.join(",") || "(none)"}  group-ic-reviewer=${g.grant_holders["group-ic-reviewer"]?.join(",") || "(none)"}  second holder ready: ${g.second_grant_holder_ready ? "yes" : "NO"}` : pendTxt("readiness.grant_holders")}`);
  L.push(`  Legacy unconfirmed mandatory na rows: ${g.legacy_unconfirmed_mandatory_na ? `${g.legacy_unconfirmed_mandatory_na.rows}${g.legacy_unconfirmed_mandatory_na.projects.map((p) => ` ${p.project_id}=${p.rows}`).join("")}` : pendTxt("readiness.legacy_unconfirmed_mandatory_na")}`);
  L.push(`  Brownfield projects past fs missing validators: ${g.brownfield_missing_validators ? `${g.brownfield_missing_validators.length}${g.brownfield_missing_validators.map((p) => ` ${p.project_id}[${p.missing.join(",")}]`).join("")}` : pendTxt("readiness.brownfield_missing_validators")}`);
  L.push(`  S8+ projects with provisional WACC: ${g.s8_provisional_wacc ? `${g.s8_provisional_wacc.length}${g.s8_provisional_wacc.map((p) => ` ${p.project_id}[${p.missing.join(",")}]`).join("")}` : pendTxt("readiness.s8_provisional_wacc")}`);
  if (r.unapplied_migrations.length > 0) L.push("", `Unapplied gate-integrity migrations: ${r.unapplied_migrations.join(", ")}`);
  return L.join("\n");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const dbPath = arg("--db-path") ?? process.env.CO_NEWBIZ_DB_PATH ?? join(import.meta.dirname, "../../db/data/co-newbiz.sqlite");
  if (!existsSync(dbPath)) {
    console.error(`database not found: ${dbPath}`);
    process.exit(2);
  }
  const days = Number(arg("--days") ?? 14);
  const to = arg("--to") ?? new Date(Date.now() + 86_400_000).toISOString();
  const from = arg("--from") ?? new Date(Date.parse(to) - days * 86_400_000).toISOString();
  const db = new Database(dbPath, { readonly: true });
  try {
    const report = buildShadowReport(db, { from, to });
    console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : renderHuman(report));
  } finally {
    db.close();
  }
}
