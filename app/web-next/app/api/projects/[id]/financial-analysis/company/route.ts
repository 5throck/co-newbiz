// POST /api/projects/[id]/financial-analysis/company — bind (or re-bind) the
// project's subject company (ADR-0116 Phase 1 bridge tab). role follows the
// track: brownfield → 'target' (인수 대상), greenfield → 'candidate' (분석
// 기준 회사) — derived for display, not stored. A non-empty rationale is
// mandatory and lands in md_project.subject_company_rationale (migration
// 0084). project_company is deliberately NOT used — migration 0073 dropped
// it as a dead surface superseded by brownfield_target. Re-binding updates
// the binding in place; the previous binding survives in the audit log.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "Company linking requires the analyst role or higher.");
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();

  const body = (await request.json().catch(() => null)) as { company_id?: string; rationale?: string } | null;
  const companyId = body?.company_id?.trim();
  const rationale = body?.rationale?.trim();
  if (!companyId) return badRequest("company_id_required", "Specify the company to link.");
  if (!rationale) return badRequest("rationale_required", "Linking rationale is required.");

  const db = getDb();
  const projectRow = db.query("SELECT id, track FROM md_project WHERE id = ?").get(id) as { id: string; track: string | null } | undefined;
  if (!projectRow) return notFound();
  const company = db.query("SELECT id, name_ko FROM md_company WHERE id = ?").get(companyId) as { id: string; name_ko: string } | undefined;
  if (!company) return badRequest("company_not_found", "Company not found — verify the id via /api/companies search.");

  const role = projectRow.track === "brownfield" ? "target" : "candidate";
  const previous = db.query("SELECT company_id, subject_company_rationale FROM md_project WHERE id = ?").get(id) as
    | { company_id: string | null; subject_company_rationale: string | null };
  db.run(
    "UPDATE md_project SET company_id = ?, subject_company_rationale = ? WHERE id = ?",
    [company.id, rationale, id],
  );
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "project_company_link",
    target: `${id}:${company.id}${previous.company_id ? ` (previous: ${previous.company_id})` : ""}`,
    now: new Date().toISOString(),
  });
  return ok({ project_id: id, company_id: company.id, company_name: company.name_ko, role, rationale }, 200, {
    rebound: previous.company_id !== null && previous.company_id !== company.id,
  });
}
