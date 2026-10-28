// @version 1.1.0
// Open a project re-confirmation requirement (ADR-0186 owner decision O-6, migration 0179) from the command line.
// --project accepts the internal md_project.id or the human project_no (resolved once to the internal id).
// Data-driven: the project is an argument, nothing project-specific lives in code. The acting user must be an
// administrator account (the same authority as POST /api/projects/:id/reconfirm). Dry-run by default.
//
// Usage:
//   bun scripts/co-newbiz/reconfirm-requirement.ts --project <id|project_no> --by <admin-user> [--items wacc_confirmed,ic_countersign,na_review]
//        [--reason "<text>"] [--db-path <path>] [--apply]
//
// PRJ-DSE4PW (owner/dba runs this on the real DB after a backup):
//   bun scripts/co-newbiz/reconfirm-requirement.ts --project PRJ-DSE4PW --by <admin-user> --apply
import { getDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { createRequirement, ReconfirmError, RECONFIRM_ITEMS, reconfirmStatus, resolveProjectRef } from "../../app/web-next/lib/reconfirm.ts";

const DEFAULT_REASON = "The recorded gate history was made under the legacy rules (a single recorder, no confirmed discount rate, unreviewed na rows); it is re-confirmed by people before new use (ADR-0186 O-6).";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function runReconfirmRequirement(opts: { dbPath?: string; project: string; by: string; items?: string[]; reason?: string; apply: boolean }): { applied: boolean; id: string | null; message: string } {
  runMigrations(opts.dbPath);
  const db = getDb(opts.dbPath);
  const user = db.query("SELECT role, status FROM app_user WHERE user_id = ?").get(opts.by) as { role: string; status: string } | null;
  if (!user || user.role !== "admin") return { applied: false, id: null, message: `--by ${opts.by} is not an administrator account.` };
  const ref = resolveProjectRef(db, opts.project);
  if (!ref.ok) return { applied: false, id: null, message: ref.reason === "ambiguous" ? `project ${opts.project} is ambiguous (matches more than one project by id / project_no); use the internal id.` : `project ${opts.project} not found (expected an md_project id or project_no).` };
  const projectId = ref.id;
  const mapping = `${opts.project} → ${projectId}`;
  const existing = reconfirmStatus(db, projectId);
  if (existing) return { applied: false, id: existing.id, message: `${mapping}: an open requirement already exists (${existing.id}); unmet: ${existing.unmet.join(", ") || "none"}.` };
  if (!opts.apply) return { applied: false, id: null, message: `dry run: ${mapping}: would open a requirement on ${projectId} (${(opts.items ?? [...RECONFIRM_ITEMS]).join(", ")}). Re-run with --apply.` };
  try {
    const row = createRequirement(db, { projectId, items: opts.items ?? [...RECONFIRM_ITEMS], reason: opts.reason ?? DEFAULT_REASON, by: opts.by, now: new Date().toISOString() });
    return { applied: true, id: row.id, message: `${mapping}: opened requirement ${row.id} on ${projectId}.` };
  } catch (e) {
    if (e instanceof ReconfirmError) return { applied: false, id: null, message: `${e.failure.code}: ${e.failure.message}` };
    throw e;
  }
}

if (import.meta.main) {
  const project = arg("--project");
  const by = arg("--by");
  if (!project || !by) {
    console.error("usage: bun scripts/co-newbiz/reconfirm-requirement.ts --project <id|project_no> --by <admin-user> [--items a,b] [--reason text] [--db-path p] [--apply]");
    process.exit(2);
  }
  const r = runReconfirmRequirement({ dbPath: arg("--db-path"), project, by, items: arg("--items")?.split(",").map((s) => s.trim()).filter(Boolean), reason: arg("--reason"), apply: process.argv.includes("--apply") });
  console.log(r.message);
  process.exit(r.applied || r.message.startsWith("dry run") ? 0 : 1);
}
