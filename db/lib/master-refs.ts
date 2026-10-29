// @version 1.0.0
/**
 * Referential-usage check for master-data rows. Walks every table's declared foreign keys
 * (PRAGMA foreign_key_list) and counts the rows that still point at the given master row, so
 * the admin console can refuse a delete with a readable list instead of a raw constraint error.
 * Table and column names come from sqlite_master / the pragma, never from request input.
 */
import type { Database } from "bun:sqlite";

export interface MasterRef {
  table: string;
  column: string;
  count: number;
}

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

export function findMasterReferences(db: Database, table: string, id: string): MasterRef[] {
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  const hits: MasterRef[] = [];
  const valueCache = new Map<string, unknown>();
  for (const { name } of tables) {
    const fks = db.query(`PRAGMA foreign_key_list(${quote(name)})`).all() as { table: string; from: string; to: string | null }[];
    for (const fk of fks) {
      if (fk.table !== table) continue;
      const targetCol = fk.to ?? "id";
      if (!valueCache.has(targetCol)) {
        const row = db.query(`SELECT ${quote(targetCol)} AS v FROM ${quote(table)} WHERE id = ?`).get(id) as { v: unknown } | null;
        valueCache.set(targetCol, row ? row.v : undefined);
      }
      const value = valueCache.get(targetCol);
      if (value === undefined || value === null) continue;
      const n = (db.query(`SELECT COUNT(*) AS n FROM ${quote(name)} WHERE ${quote(fk.from)} = ?`).get(value as string) as { n: number }).n;
      if (n > 0) hits.push({ table: name, column: fk.from, count: n });
    }
  }
  return hits;
}
