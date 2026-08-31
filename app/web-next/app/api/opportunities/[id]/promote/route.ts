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
  const body = (await request.json().catch(() => null)) as {
    project_no?: string;
    track?: "greenfield" | "brownfield";
    company_name?: string; // brownfield: 주 대상 기업 (선별 시 확정 가능 — 선택)
    target_candidates?: string[]; // brownfield Long List (1개 이상 권장)
  } | null;
  if (!body?.project_no?.trim()) {
    return badRequest("invalid_request", "project_no is required.");
  }
  const track = body.track === "greenfield" ? "greenfield" : "brownfield";
  const companyName = body.company_name?.trim() || null;
  const candidates = (body.target_candidates ?? []).map((n) => n.trim()).filter(Boolean);
  // 트랙 분기: brownfield는 대상 기업 후보(Long List) 등록이 절차상 필요하고,
  // greenfield는 대상 기업 객체 자체가 없다(자체 역량 진출).
  if (track === "brownfield" && candidates.length === 0 && !companyName) {
    return badRequest(
      "candidates_required",
      "brownfield 승격은 대상 기업 후보(Long List) 또는 주 대상 기업 1개 이상이 필요합니다.",
    );
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
  const findOrCreateCompany = async (name: string): Promise<{ id: string }> => {
    let c = db.query("SELECT id FROM md_company WHERE name_ko = ?").get(name) as { id: string } | null;
    if (!c) {
      const { ulid } = await import("../../../../../../../db/lib/ulid.ts");
      const companyId = ulid();
      db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [companyId, name, now]);
      c = { id: companyId };
    }
    return c;
  };
  const project = createProject(body.project_no.trim());
  // 역할 매핑: brownfield → 후보(Long List)·주 대상(target), greenfield → 대상 없음.
  if (track === "brownfield") {
    const { ulid } = await import("../../../../../../../db/lib/ulid.ts");
    for (const name of candidates) {
      const c = await findOrCreateCompany(name);
      db.run(
        `INSERT OR IGNORE INTO project_company (id, project_id, company_id, role, created_at) VALUES (?,?,?,?,?)`,
        [ulid(), project.id, c.id, "candidate", now],
      );
    }
    if (companyName) {
      const primary = await findOrCreateCompany(companyName);
      db.run(
        `INSERT OR IGNORE INTO project_company (id, project_id, company_id, role, created_at) VALUES (?,?,?,?,?)`,
        [ulid(), project.id, primary.id, "target", now],
      );
      db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [primary.id, project.id]);
    }
  }
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
