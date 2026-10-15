// @version 1.0.0
// ADR-0171 Consequences: ONE-OFF, person-run script. Copies legacy Brown Field required-capability
// judgements (stored on the S3 register rows) to each Brown Field project's SELECTED target as
// UNCONFIRMED judgements in brownfield_target_capability_judgement.
//
// - Dry-run by default; nothing is written without --apply.
// - Skips rows/targets that already have a judgement (never overwrites); rows without a seeded S7
//   criterion are skipped (run the S7 criteria reconcile first). Idempotent.
// - Confirmation is never copied (human-only). One audit row per copy, actor "script:legacy-copy".
// - No values are invented: only what is stored on the S3 row is copied.
//
// Usage: bun run scripts/co-newbiz/copy-legacy-bf-capability-judgements.ts [--apply]
// Point CO_NEWBIZ_DB_PATH at a read-only COPY of the database for a dry-run.
import type { Database } from "bun:sqlite";
import { getDb } from "../../db/client.ts";
import { selectedTargetId } from "../../app/web-next/lib/dd-target.ts";
import { copyLegacyJudgementsToTarget, targetScope, type LegacyCopyItem } from "../../app/web-next/lib/brownfield-capability-judgement.ts";

export interface LegacyCopyReport {
  projectId: string;
  targetId: string | null;
  skipped: string | null;
  items: LegacyCopyItem[];
}

export function runLegacyCopy(db: Database, opts: { apply: boolean; now?: string }): LegacyCopyReport[] {
  const at = opts.now ?? new Date().toISOString();
  const projects = db.query("SELECT id FROM md_project WHERE track = 'brownfield' AND source_opportunity_id IS NOT NULL ORDER BY id").all() as Array<{ id: string }>;
  return projects.map(({ id }) => {
    const tid = selectedTargetId(id, db);
    if (!tid) return { projectId: id, targetId: null, skipped: "no selected target", items: [] };
    const scope = targetScope(db, tid);
    if (!scope.ok) return { projectId: id, targetId: tid, skipped: scope.message, items: [] };
    return { projectId: id, targetId: tid, skipped: null, items: copyLegacyJudgementsToTarget(db, scope.target, { apply: opts.apply, actor: "script:legacy-copy", at }) };
  });
}

if (import.meta.main) {
  const apply = process.argv.includes("--apply");
  const report = runLegacyCopy(getDb(), { apply });
  for (const r of report) {
    console.log(`${r.projectId} target=${r.targetId ?? "-"}${r.skipped ? ` SKIP (${r.skipped})` : ""}`);
    for (const i of r.items) console.log(`  ${i.outcome.padEnd(18)} ${i.rowId} ${i.capability}`);
  }
  const copied = report.reduce((n, r) => n + r.items.filter((i) => i.outcome === "copied").length, 0);
  console.log(`${apply ? "APPLIED" : "DRY-RUN (no changes; pass --apply to write)"}: ${copied} judgement(s) ${apply ? "copied" : "would be copied"}.`);
}
