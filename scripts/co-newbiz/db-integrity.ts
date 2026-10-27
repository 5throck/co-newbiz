// @version 1.0.2
// 1.0.2 (ADR-0186 P3 H1): when the gate_decision delete guard (migration 0175) exists, --fix deletes nothing and only reports; orphans stay visible.
// 1.0.1 (ADR-0186 P2): --fix never orphan-deletes snapshot-bearing gate decisions (skipped, still reported).
// co-newbiz DB integrity gate.
//
// SQLite FKs cover ordinary relationships, but gate_decision intentionally uses
// a polymorphic (entity_type, entity_id) reference so the same human decision
// ledger can address opportunities (S1-S7) and projects (S8-S12). That shape
// cannot be expressed as a single SQLite FK; this script supplies the missing
// mechanical gate and can optionally prune orphan gate decisions from a local
// demo database.
//
// Usage:
//   bun scripts/co-newbiz/db-integrity.ts [--db-path <path>] [--fix]
//
// Default mode is read-only and exits 1 on any integrity issue. --fix deletes
// only gate_decision rows whose typed target row is absent.
import { getDb } from "../../db/client.ts";

type Db = ReturnType<typeof getDb>;

export interface GateDecisionReferenceIssue {
  id: string;
  entity_type: string;
  entity_id: string;
  gate: string;
  decision: string;
  reason: "missing_opportunity" | "missing_project" | "unknown_entity_type";
}

function tableExists(db: Db, name: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return Boolean(row);
}

export function findGateDecisionReferenceIssues(db: Db): GateDecisionReferenceIssue[] {
  if (!tableExists(db, "gate_decision")) return [];
  const issues: GateDecisionReferenceIssue[] = [];

  if (tableExists(db, "opportunity")) {
    issues.push(
      ...(db.query(`
        SELECT gd.id, gd.entity_type, gd.entity_id, gd.gate, gd.decision, 'missing_opportunity' AS reason
          FROM gate_decision gd
          LEFT JOIN opportunity o ON o.id = gd.entity_id
         WHERE gd.entity_type = 'opportunity'
           AND o.id IS NULL
         ORDER BY gd.decided_at, gd.id
      `).all() as GateDecisionReferenceIssue[]),
    );
  }

  if (tableExists(db, "md_project")) {
    issues.push(
      ...(db.query(`
        SELECT gd.id, gd.entity_type, gd.entity_id, gd.gate, gd.decision, 'missing_project' AS reason
          FROM gate_decision gd
          LEFT JOIN md_project p ON p.id = gd.entity_id
         WHERE gd.entity_type = 'project'
           AND p.id IS NULL
         ORDER BY gd.decided_at, gd.id
      `).all() as GateDecisionReferenceIssue[]),
    );
  }

  issues.push(
    ...(db.query(`
      SELECT id, entity_type, entity_id, gate, decision, 'unknown_entity_type' AS reason
        FROM gate_decision
       WHERE entity_type NOT IN ('opportunity', 'project')
       ORDER BY decided_at, id
    `).all() as GateDecisionReferenceIssue[]),
  );

  return issues.sort((a, b) => a.id.localeCompare(b.id));
}

export function deleteOrphanGateDecisions(db: Db): number {
  // ADR-0186 H1: gate_decision rows are immutable evidence once migration 0175 installs the delete guard (it also anchors the
  // legacy cutoff, which is a rowid mark). Report instead of delete; the database refuses the DELETE anyway.
  if (db.query("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_gate_decision_no_delete'").get()) {
    const reported = findGateDecisionReferenceIssues(db).filter((i) => i.reason !== "unknown_entity_type").length;
    if (reported > 0) console.warn(`db-integrity: ${reported} orphan gate_decision row(s) are reported only - gate decisions are never deleted (ADR-0186).`);
    return 0;
  }
  // ADR-0186: a decision with a gate_decision_snapshot is append-only evidence - never orphan-deleted (reported, skipped).
  const hasSnapshotTable = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'gate_decision_snapshot'").get() !== null;
  const withSnapshot = new Set(
    hasSnapshotTable ? (db.query("SELECT decision_id FROM gate_decision_snapshot").all() as Array<{ decision_id: string }>).map((r) => r.decision_id) : [],
  );
  const issues = findGateDecisionReferenceIssues(db).filter((i) => i.reason !== "unknown_entity_type" && !withSnapshot.has(i.id));
  if (issues.length === 0) return 0;
  const deleteOne = db.prepare("DELETE FROM gate_decision WHERE id = ?");
  db.transaction(() => {
    for (const issue of issues) deleteOne.run(issue.id);
  })();
  return issues.length;
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function runDbIntegrity(args = process.argv.slice(2)): number {
  const db = getDb(argValue(args, "--db-path"));
  const fix = args.includes("--fix");
  const fkIssues = db.query("PRAGMA foreign_key_check").all() as unknown[];
  const gateIssues = findGateDecisionReferenceIssues(db);

  if (fix && gateIssues.some((i) => i.reason !== "unknown_entity_type")) {
    const deleted = deleteOrphanGateDecisions(db);
    console.log(`db-integrity: deleted ${deleted} orphan gate_decision row(s).`);
  }

  const remainingGateIssues = findGateDecisionReferenceIssues(db);
  if (fkIssues.length === 0 && remainingGateIssues.length === 0) {
    console.log("db-integrity: clean.");
    return 0;
  }

  if (fkIssues.length > 0) {
    console.error(`db-integrity: PRAGMA foreign_key_check returned ${fkIssues.length} issue(s).`);
    for (const issue of fkIssues) console.error("  -", JSON.stringify(issue));
  }
  if (remainingGateIssues.length > 0) {
    console.error(`db-integrity: gate_decision has ${remainingGateIssues.length} polymorphic reference issue(s).`);
    for (const issue of remainingGateIssues) {
      console.error(`  - ${issue.id}: ${issue.entity_type}:${issue.entity_id} ${issue.gate}/${issue.decision} (${issue.reason})`);
    }
    if (!fix) console.error("  Fix local demo data with: bun scripts/co-newbiz/db-integrity.ts --fix");
  }
  return 1;
}

if (import.meta.main) process.exit(runDbIntegrity());
