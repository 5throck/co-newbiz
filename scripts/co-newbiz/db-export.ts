#!/usr/bin/env bun
// @version 1.0.0
/**
 * db-export.ts — ADR-0002's portability verification mechanism.
 *
 * ADR-0002 promises that leaving SQLite for Postgres is "a data-export/import
 * exercise, not a rewrite" — but the export itself did not exist, so the
 * portability claim was untestable aspiration. This module makes it
 * checkable: `db:export --dialect postgres` produces a psql-runnable dump of
 * schema + data, and the few dialect gaps are surfaced as explicit header
 * warnings instead of being silently emitted.
 *
 * Fidelity contract (stated, never hidden):
 *   - Types map: INTEGER→BIGINT, REAL→DOUBLE PRECISION, TEXT→TEXT, BLOB→BYTEA.
 *     (Money is integer minor units per ADR-0002 wherever tables follow the
 *     convention; legacy REAL money columns export as DOUBLE PRECISION and
 *     remain visible as the recorded schema debt they are.)
 *   - SQLite's GLOB operator inside CHECK constraints has no Postgres
 *     equivalent — affected statements are emitted verbatim AND listed in
 *     the header warnings block so an importer rewrites them (e.g. to ~
 *     regexes) before applying.
 *   - Internal tables (`sqlite_*`) and the `schema_migrations` bookkeeping
 *     table are skipped; AUTOINCREMENT does not exist anywhere by ADR-0002.
 *   - Data section sets session_replication_role = replica so FK ordering
 *     across tables cannot fail the import (requires superuser — noted in
 *     the header).
 */

import { writeFileSync } from "node:fs";
import { getDb } from "../../db/client.ts";

export interface ExportResult {
  sql: string;
  warnings: string[];
  tableCount: number;
  rowCount: number;
}

export interface ExportOptions {
  dbPath?: string;
}

const SKIP_TABLES = new Set(["schema_migrations"]);

function mapType(typeToken: string): string {
  const t = typeToken.trim().toUpperCase();
  if (t.startsWith("INTEGER") || t.startsWith("INT")) return "BIGINT";
  if (t.startsWith("REAL") || t.startsWith("FLOA") || t.startsWith("DOUB")) return "DOUBLE PRECISION";
  if (t.startsWith("TEXT") || t.startsWith("CHAR") || t.startsWith("CLOB")) return "TEXT";
  if (t.startsWith("BLOB")) return "BYTEA";
  return typeToken.trim();
}

/** Rewrite one CREATE TABLE statement into Postgres dialect. */
function translateCreateTable(sql: string): string {
  let out = sql.replace(/\s+STRICT\s*;?\s*$/i, ";").replace(/\s+WITHOUT\s+ROWID\s*;?\s*$/i, ";");
  // Column-level types only: lines like `  col_name TYPE rest...` where TYPE
  // is a SQLite storage class. Table-level constraints (PRIMARY KEY(...),
  // UNIQUE(...), CHECK(...), FOREIGN KEY...) start with those keywords and
  // carry no bare type token after a name, so they pass through untouched.
  out = out.replace(
    /^(\s*)("?[\w]+"?)(\s+)(INTEGER|INT|REAL|TEXT|BLOB|VARCHAR|BOOLEAN|FLOAT|DOUBLE|NUMERIC)(\b[^,\n)]*)/gm,
    (_m, indent: string, name: string, gap: string, type: string, rest: string) =>
      `${indent}${name}${gap}${mapType(type)}${rest}`,
  );
  return out;
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "'NaN'::double precision";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString("hex")}'`;
  const s = String(v);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) {
    return "E'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/[\x00-\x1f]/g, (ch) => `\\${ch.charCodeAt(0).toString(8).padStart(3, "0")}`) + "'";
  }
  return `'${s.replace(/'/g, "''")}'`;
}

export function runDbExport(options: ExportOptions = {}): ExportResult {
  const db = getDb(options.dbPath);
  const warnings: string[] = [];

  interface MasterRow { type: string; name: string; tbl_name: string; sql: string | null }
  const objects = db.query(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid",
  ).all() as MasterRow[];

  const tables = objects.filter((o) => o.type === "table" && !o.name.startsWith("sqlite_") && !SKIP_TABLES.has(o.name));
  const indexes = objects.filter((o) => o.type === "index" && !o.name.startsWith("sqlite_autoindex_") && !SKIP_TABLES.has(o.tbl_name));

  const parts: string[] = [];
  parts.push(`-- co-newbiz database export — generated ${new Date().toISOString()}`);
  parts.push(`-- Source engine: SQLite (bun:sqlite). Target dialect: postgres.`);
  parts.push(`-- ADR-0002 portability check artifact: feed to psql on an empty database.`);
  parts.push(`-- Tables exported: ${tables.length}.`);

  const globTables = tables.filter((t) => /\bGLOB\b/i.test(t.sql ?? ""));
  if (globTables.length > 0) {
    warnings.push(
      `${globTables.length} table(s) use SQLite GLOB in CHECK constraints (no Postgres equivalent): ` +
        globTables.map((t) => t.name).join(", ") +
        " — rewrite each GLOB predicate (e.g. to a regex ~) before applying.",
    );
  }
  warnings.push(
    "Data section requires session_replication_role = replica (superuser) so cross-table FK insert order cannot fail.",
  );
  for (const w of warnings) parts.push(`-- WARNING: ${w}`);

  parts.push("", "-- ---------------------------------------------------------------------------", "-- Schema", "-- ---------------------------------------------------------------------------");
  for (const t of tables) {
    parts.push(translateCreateTable(t.sql!) + ";");
  }

  parts.push("", "-- ---------------------------------------------------------------------------", "-- Data", "-- ---------------------------------------------------------------------------");
  parts.push("SET session_replication_role = replica;");
  let rowCount = 0;
  for (const t of tables) {
    const cols = (db.query(`PRAGMA table_info(${JSON.stringify(t.name)})`).all() as { name: string }[]).map((c) => JSON.stringify(c.name));
    if (cols.length === 0) continue;
    const rows = db.query(`SELECT * FROM ${JSON.stringify(t.name)}`).all() as Record<string, unknown>[];
    if (rows.length === 0) continue;
    const collist = cols.join(", ");
    for (const row of rows) {
      rowCount++;
      const values = cols.map((_, i) => literal(Object.values(row)[i])).join(", ");
      parts.push(`INSERT INTO ${JSON.stringify(t.name)} (${collist}) VALUES (${values});`);
    }
  }
  parts.push("RESET session_replication_role;");

  parts.push("", "-- ---------------------------------------------------------------------------", "-- Indexes", "-- ---------------------------------------------------------------------------");
  for (const idx of indexes) {
    parts.push(idx.sql!.replace(/\s+;?\s*$/, ";"));
  }

  const sql = parts.join("\n") + "\n";
  return { sql, warnings, tableCount: tables.length, rowCount };
}

/** CLI entry — prints usage-compatible output for newbiz.ts `db:export`. */
export function runExportCommand(args: string[]): void {
  const dbPathIdx = args.indexOf("--db-path");
  const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;

  const result = runDbExport({ dbPath });
  if (outPath) {
    writeFileSync(outPath, result.sql, "utf-8");
    console.log(`✅ Exported ${result.tableCount} table(s), ${result.rowCount} row(s) → ${outPath}`);
  } else {
    process.stdout.write(result.sql);
  }
  for (const w of result.warnings) console.error(`⚠️  ${w}`);
}
