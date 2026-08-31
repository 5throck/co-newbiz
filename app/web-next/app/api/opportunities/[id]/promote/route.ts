// Promote a selected opportunity to a project/deal (S4 → project creation).
// Creates the project (route_decision.project_id is backfilled by the
// route-decision flow or here), grants the promoter lead membership, links
// the opportunity to the new project, and stamps the funnel transition.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit, grantProjectMembership } from "../../../../../../../db/lib/access-control.ts";
import { createProject } from "../../../../../../../db/repositories/project.repository.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") {
    return forbidden("role_required", "Promoting an opportunity requires the analyst role.");
  }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { project_no?: string; company_name?: string } | null;
  if (!body?.project_no?.trim()) {
    return badRequest("invalid_request", "project_no is required.");
  }
  // 프로젝트 등록 시 대상 회사 필수 — 어떤 회사를 대상으로 하는지 명확해야 한다.
  const companyName = body.company_name?.trim();
  if (!companyName) {
    return badRequest("company_required", "company_name is required — a project must name its target company.");
  }

  const db = getDb();
  const opp = db
    .query("SELECT id, name, status, project_id FROM opportunity WHERE id = ?")
    .get(id) as { id: string; name: string; status: string; project_id: string | null } | null;
  if (!opp) return notFound();
  if (opp.status !== "selected") {
    return badRequest("not_selected", "Only opportunities with status='selected' can be promoted.");
  }
  if (opp.project_id) {
    return badRequest("already_promoted", `Opportunity already promoted to project ${opp.project_id}.`);
  }

  const now = new Date().toISOString();
  let company = db.query("SELECT id FROM md_company WHERE name_ko = ?").get(companyName) as { id: string } | null;
  if (!company) {
    const { ulid } = await import("../../../../../../../db/lib/ulid.ts");
    const companyId = ulid();
    db.run(
      "INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)",
      [companyId, companyName, now],
    );
    company = { id: companyId };
  }
  const project = createProject(body.project_no.trim());
  db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [company.id, project.id]);
  grantProjectMembership(db, {
    projectId: project.id,
    userId: ctx.userId,
    projectRole: "lead",
    grantedBy: ctx.userId,
    needToKnowBasis: `opportunity promoter (${opp.name})`,
    now,
  });
  db.run("UPDATE opportunity SET project_id = ? WHERE id = ?", [project.id, id]);
  appendAudit(db, {
    actor: ctx.userId,
    action: "opportunity_promote",
    target: `${id} -> ${project.id}`,
    now,
  });
  return ok({ opportunity_id: id, project_id: project.id, project_no: body.project_no.trim() }, 201);
}
