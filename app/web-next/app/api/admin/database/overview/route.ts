// Read-only database overview for /admin/database: retention-eligible tables
// (row count, oldest/newest date per eligible column, policy presence) and the
// migration status. Aggregates only — never returns row data. Admin role.
import { getDb } from "../../../../../../../db/client.ts";
import { RETENTION_ELIGIBLE_TABLES } from "../../../../../../../db/lib/retention-registry.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const db = getDb();

  const policies = new Map(
    (db.query("SELECT table_key, basis, retention_months, action FROM retention_policy").all() as Array<{
      table_key: string; basis: string; retention_months: number; action: string;
    }>).map((p) => [p.table_key, p]),
  );

  const tables = RETENTION_ELIGIBLE_TABLES.map((t) => {
    const rowCount = (db.query(`SELECT COUNT(*) AS n FROM ${t.table}`).get() as { n: number }).n;
    const dateColumns = t.dateColumns.map((c) => {
      const r = db.query(`SELECT MIN(${c.column}) AS oldest, MAX(${c.column}) AS newest FROM ${t.table}`).get() as {
        oldest: string | null; newest: string | null;
      };
      return { column: c.column, label: c.label, oldest: r.oldest, newest: r.newest };
    });
    const p = policies.get(t.table);
    return {
      table: t.table,
      label: t.label,
      description: t.description,
      handling: t.handling,
      row_count: rowCount,
      date_columns: dateColumns,
      policy: p ? { basis: p.basis, retention_months: p.retention_months, action: p.action } : null,
    };
  });

  const migrations = db.query("SELECT filename, applied_at FROM schema_migrations ORDER BY filename").all() as Array<{
    filename: string; applied_at: string;
  }>;
  const latest = migrations[migrations.length - 1] ?? null;

  return ok({
    tables,
    migrations: { applied_count: migrations.length, latest: latest ? { filename: latest.filename, applied_at: latest.applied_at } : null },
    backup_history: null, // no data source yet (dba owns backups under db/backups)
  });
}
