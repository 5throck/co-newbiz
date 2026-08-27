// Reports list — web-implementation-plan M5. Lists generated documents
// (document table) with their superseded chain, joined through run -> project.
// Authenticated; documents are report outputs so no per-row project scoping is
// needed at the list level (membership scoping is a follow-up when per-project
// report libraries are introduced).
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const rows = getDb()
    .query(
      `SELECT d.id AS id, d.run_id AS run_id, r.project_id AS project_id, r.label AS run_label,
              d.version AS version, d.superseded_by AS superseded_by,
              d.document_section_hash AS document_section_hash, d.created_at AS created_at
       FROM document d JOIN run r ON d.run_id = r.id
       ORDER BY d.created_at DESC`,
    )
    .all();
  const docs = rows as {
    id: string;
    run_id: string;
    project_id: string;
    run_label: string | null;
    version: number;
    superseded_by: string | null;
    document_section_hash: string | null;
    created_at: string;
  }[];
  const current = docs.filter((d) => d.superseded_by === null).length;
  return ok(docs, 200, { count: docs.length, current });
}
