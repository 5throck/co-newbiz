// Admin — governance document registry. Lists policy/procedure/guideline/
// checklist/template documents with enforceability, supersession, review-due
// status, active-waiver concentration and the docs-hub link. Read-only: the
// documents are edited in the repo and `POST /api/admin/governance/sync`
// refreshes the registry from the committed manifest.
import { getDb } from "../../../../../../db/client.ts";
import { listGovernanceView } from "../../../../../../db/lib/governance-registry.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";
import { listLibrary } from "../../../../lib/library.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  // doc_path -> docs-hub id (first entry wins; the ko/en pair shares one id).
  const libraryIndex = new Map<string, string>();
  for (const d of listLibrary()) if (!libraryIndex.has(d.file)) libraryIndex.set(d.file, d.id);
  const rows = listGovernanceView(getDb(), { now: new Date().toISOString(), libraryIndex });
  return ok(rows, 200, { count: rows.length });
}
