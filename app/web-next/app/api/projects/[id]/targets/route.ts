// GET /api/projects/[id]/targets — the shortlist analysis targets of a
// brownfield project (ADR-0156). Drives the per-target selector on the WACC
// and financial-analysis pages: each shortlisted brownfield_target with its
// resolved md_company id (dart_corp_code first, name_ko fallback — the
// ADR-0143 rule) and whether its company is the project's ADR-0116 subject
// binding (isBound). Greenfield and single-target projects return a short
// list the UI simply may not render as a selector.
import { getDb } from "../../../../../../../db/client.ts";
import { listProjectAnalysisTargets } from "../../../../../../../db/lib/wacc.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  const db = getDb();
  const targets = listProjectAnalysisTargets(db, id);
  return ok(
    {
      project_id: id,
      targets,
      // The selector is worth showing only when a real choice exists.
      selectable: targets.length > 1,
    },
    200,
    { target_count: targets.length },
  );
}
