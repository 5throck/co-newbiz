// GET /api/admin/project-options?q=<query> — admin-only project picker options
// for the watch create dialog (2026-11-27 user request: find projects by NAME,
// not only by raw ID). FR-SEC-02 note: this RELAXES the previous "project named
// by ID only" admin posture — the options carry `project_name` alongside
// `project_no` so a non-member admin can identify a project. Read-only list
// (like /api/admin/users), deleted projects are excluded, capped at 20 rows.
import { getDb } from "../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export interface AdminProjectOption {
  id: string;
  project_no: string;
  project_name: string | null;
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;

  const q = (new URLSearchParams(new URL(request.url).search).get("q") ?? "").trim();
  const db = getDb();
  const rows = (
    q
      ? db
          .prepare(
            `SELECT id, project_no, project_name FROM md_project
             WHERE deleted_at IS NULL AND (project_no LIKE ? OR project_name LIKE ?)
             ORDER BY project_no LIMIT 20`,
          )
          .all(`%${q}%`, `%${q}%`)
      : db
          .prepare(
            `SELECT id, project_no, project_name FROM md_project
             WHERE deleted_at IS NULL ORDER BY project_no LIMIT 20`,
          )
          .all()
  ) as AdminProjectOption[];
  return ok(rows);
}
