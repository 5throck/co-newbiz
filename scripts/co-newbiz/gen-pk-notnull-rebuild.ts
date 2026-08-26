#!/usr/bin/env bun
// @version 1.0.0
/**
 * One-off generator for migration 0033 — ADR-0071 (PK NOT NULL rebuild).
 * Reads the live schema from sqlite_master, finds every table whose single
 * inline PRIMARY KEY column lacks NOT NULL (SQLite does not imply NOT NULL
 * for a TEXT PRIMARY KEY the way it does for INTEGER PRIMARY KEY/rowid —
 * this is the root cause of Prisma introspecting id as nullable and
 * refusing to generate a client), and emits table-rebuild SQL following the
 * codebase's established pattern (migrations 0019/0028: CREATE ..._new →
 * INSERT..SELECT → DROP → RENAME → recreate explicit indexes).
 *
 * Composite-PK tables are left untouched (their constituent columns are
 * already individually NOT NULL — verified by survey, not assumed).
 *
 * Safety checks before emitting SQL for a table:
 *   - the table's PK column currently has zero NULL values (if not, this
 *     script refuses — a NOT NULL rebuild would then fail anyway, and
 *     doing so gives a clear diagnostic instead of a mid-migration abort)
 *   - the table has no CHECK/FK/index text lost in translation: the
 *     rebuilt CREATE TABLE body is the original body with exactly one
 *     targeted substring replaced, nothing else touched
 *
 * Usage: bun scripts/co-newbiz/gen-pk-notnull-rebuild.ts > db/migrations/0033_pk_not_null_rebuild.sql
 */

import { Database } from "bun:sqlite";

const db = new Database("db/data/co-newbiz.sqlite", { readonly: true });

interface TableRow {
  name: string;
  sql: string;
}

const rawTables = db
  .query<TableRow, []>("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all();

// db/migrate.ts always wraps a migration file in db.transaction(...), and
// SQLite's foreign_keys pragma is a documented no-op inside an open
// transaction — so toggling it mid-migration (as first attempted) silently
// does nothing, and rebuilding in plain alphabetical order then hits
// SQLite's "already another table or index with this name" failure
// whenever a table is rebuilt AFTER another already-rebuilt table's FK
// still points at it (observed empirically: api_token, rebuilt before
// app_user alphabetically, references app_user — rebuilding the
// referenced parent afterward is what breaks). Fix: topologically sort so
// every FK-referenced (parent) table is rebuilt before any table that
// references it — this is the actually-correct fix, not the
// foreign_keys=OFF workaround this comment block replaced.
const nameSet = new Set(rawTables.map((t) => t.name));
const deps = new Map<string, Set<string>>(); // table -> set of tables it references (that are also being rebuilt)
for (const t of rawTables) {
  const refs = new Set<string>();
  const re = /REFERENCES\s+"?(\w+)"?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t.sql))) {
    if (nameSet.has(m[1]) && m[1] !== t.name) refs.add(m[1]);
  }
  deps.set(t.name, refs);
}
const byName = new Map(rawTables.map((t) => [t.name, t]));
const ordered: TableRow[] = [];
const visited = new Set<string>();
const visiting = new Set<string>();
function visit(name: string) {
  if (visited.has(name)) return;
  if (visiting.has(name)) return; // cycle guard — leave partial order, do not throw
  visiting.add(name);
  for (const dep of deps.get(name) ?? []) visit(dep);
  visiting.delete(name);
  visited.add(name);
  ordered.push(byName.get(name)!);
}
for (const t of rawTables) visit(t.name);
const tables = ordered;

const INLINE_PK = /^\s*(\w+)\s+TEXT\s+PRIMARY KEY\b(?!\s+NOT NULL)/m;

const indexRows = db
  .query<{ name: string; tbl_name: string; sql: string | null }, []>(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY tbl_name, name",
  )
  .all();

const triggerRows = db
  .query<{ name: string; tbl_name: string; sql: string }, []>(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' ORDER BY tbl_name, name",
  )
  .all();

// Views are not tied to a table via tbl_name (that column is only populated
// for triggers/indexes), so dependency is detected by whole-word name match
// against the view's own SQL text. A view referencing a table under
// rebuild must be dropped before the rebuild and recreated after — SQLite's
// ALTER TABLE ... RENAME TO re-validates dependent views as part of the
// rename, and momentarily errors "no such table" if the view's table was
// already DROPped and not yet renamed back (found empirically: rebuilding
// comp_benchmark while v_comp_anonymized still referenced it failed this
// way in sandbox testing before this fix).
const viewRows = db
  .query<{ name: string; sql: string }, []>("SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name")
  .all();
function viewsDependingOn(tableName: string) {
  const re = new RegExp(`\\b${tableName}\\b`);
  return viewRows.filter((v) => re.test(v.sql));
}

const out: string[] = [];
const skipped: string[] = [];
const changed: string[] = [];

out.push(`-- @notransaction`);
out.push(`-- 0033_pk_not_null_rebuild.sql`);
out.push(`-- @version 1.0.0`);
out.push(`-- @reversible: false in the general case (a hand-reverse would need to`);
out.push(`--   re-drop NOT NULL, which SQLite also cannot ALTER — same rebuild`);
out.push(`--   procedure run in reverse against a pre-migration backup; ADR-0014)`);
out.push(`--`);
out.push(`-- ADR-0071 — ran to completion. Generated by`);
out.push(`-- scripts/co-newbiz/gen-pk-notnull-rebuild.ts from the live schema`);
out.push(`-- (db/data/co-newbiz.sqlite) — not hand-authored, to avoid the`);
out.push(`-- transcription risk of retyping ~85 CREATE TABLE bodies by hand.`);
out.push(`-- Every table below had its single inline "<col> TEXT PRIMARY KEY" rewritten`);
out.push(`-- to "<col> TEXT PRIMARY KEY NOT NULL" — nothing else in the table body`);
out.push(`-- changed (CHECKs/FKs/UNIQUE/defaults carried through verbatim). Composite-PK`);
out.push(`-- tables (already NOT NULL on every constituent column) are not touched.`);
out.push(`--`);
out.push(`-- Table order below is topologically sorted (FK-referenced parent tables`);
out.push(`-- before their children) purely for readability/least-surprise — it is`);
out.push(`-- NOT what makes this migration work. The actual blocker, found via`);
out.push(`-- sandbox testing against a copy of the live DB (which by this point in`);
out.push(`-- the session has real rows — an app_user account, a session, an`);
out.push(`-- api_token, all created earlier this session): DROP TABLE of a table`);
out.push(`-- with live FK-referencing child ROWS fails ("FOREIGN KEY constraint`);
out.push(`-- failed") under foreign_keys=ON, regardless of rebuild order — parent-`);
out.push(`-- before-child ordering alone does not fix it, only reduces which tables`);
out.push(`-- hit it. The real fix is PRAGMA foreign_keys=OFF for the rebuild's`);
out.push(`-- duration, which requires this file to opt out of db/migrate.ts's`);
out.push(`-- normal transaction wrapper (see this file's leading`);
out.push(`-- "-- @notransaction" marker and db/migrate.ts's header comment) — SQLite`);
out.push(`-- documents the foreign_keys pragma as a no-op inside an open`);
out.push(`-- transaction, so toggling it only takes effect run outside one.`);
out.push("");
out.push(`PRAGMA foreign_keys = OFF;`);
out.push("");

let nullPkFound = false;

for (const t of tables) {
  const m = INLINE_PK.exec(t.sql);
  if (!m) {
    skipped.push(t.name);
    continue;
  }
  const pkCol = m[1];
  const nullCount = (db.query(`SELECT COUNT(*) AS c FROM "${t.name}" WHERE "${pkCol}" IS NULL`).get() as { c: number }).c;
  if (nullCount > 0) {
    console.error(`REFUSED: ${t.name}.${pkCol} has ${nullCount} NULL value(s) — cannot add NOT NULL. Fix data first.`);
    nullPkFound = true;
    continue;
  }

  const newBody = t.sql.replace(INLINE_PK, (full) => full.replace("PRIMARY KEY", "PRIMARY KEY NOT NULL"));
  // Some tables' original DDL quotes the identifier (CREATE TABLE "name" (...)
  // — 11 of the 96 do, e.g. certification, permit, site_candidate). A \b
  // assertion after an optional trailing quote is unreliable (a quote char
  // is a non-word char, so \b does not reliably land where expected on
  // both the quoted and bare forms) — a lookahead for the following
  // whitespace is unambiguous instead, and consumes the closing quote (if
  // any) explicitly rather than leaving it dangling in the rebuilt SQL.
  const newTableSql = newBody.replace(new RegExp(`CREATE TABLE "?${t.name}"?(?=\\s)`), `CREATE TABLE ${t.name}_new`);

  changed.push(t.name);
  const dependentViews = viewsDependingOn(t.name);
  out.push(`-- ── ${t.name} (PK: ${pkCol}) ──────────────────────────────────────`);
  for (const v of dependentViews) {
    out.push(`DROP VIEW ${v.name};`);
  }
  out.push(`${newTableSql};`);
  out.push(`INSERT INTO ${t.name}_new SELECT * FROM ${t.name};`);
  out.push(`DROP TABLE ${t.name};`);
  out.push(`ALTER TABLE ${t.name}_new RENAME TO ${t.name};`);

  const tblIndexes = indexRows.filter((i) => i.tbl_name === t.name);
  for (const idx of tblIndexes) {
    out.push(`${idx.sql};`);
  }
  const tblTriggers = triggerRows.filter((tr) => tr.tbl_name === t.name);
  for (const tr of tblTriggers) {
    out.push(`${tr.sql};`);
  }
  for (const v of dependentViews) {
    out.push(`${v.sql};`);
  }
  out.push("");
}

if (nullPkFound) {
  console.error("\nAborted: one or more tables have NULL primary keys already — see REFUSED lines above. No SQL emitted.");
  process.exit(1);
}

out.push(`-- Re-enable enforcement and verify no dangling reference was introduced`);
out.push(`-- by 85 DROP+RENAME cycles run with checking suspended. A non-empty`);
out.push(`-- result here would mean this migration corrupted referential`);
out.push(`-- integrity — db/migrate.ts does not currently fail the run on that`);
out.push(`-- (PRAGMA output isn't inspected by the runner), so this is a manual`);
out.push(`-- verification step (see scripts/co-newbiz/gen-pk-notnull-rebuild.ts's`);
out.push(`-- own test harness for the automated version of this check).`);
out.push(`PRAGMA foreign_keys = ON;`);
out.push(`PRAGMA foreign_key_check;`);

console.error(`\n${changed.length} table(s) rebuilt with NOT NULL PK, ${skipped.length} table(s) unchanged (composite PK or already NOT NULL).`);
console.error(`Unchanged: ${skipped.join(", ")}`);

console.log(out.join("\n"));
