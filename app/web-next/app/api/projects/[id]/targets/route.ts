// S5 Brownfield — 대상 기업 Long/Short List 관리 (project_company 테이블).
// role: candidate(Long List) → target(Short List·주 대상). 주 대상 지정 시
// md_project.company_id가 갱신되어 이후 DD·투자심사가 해당 기업으로 진행된다.
import { getDb } from "../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const db = getDb();
  const targets = db
    .query(
      `SELECT pc.id, pc.company_id, pc.role, c.name_ko AS company_name, c.dart_corp_code
       FROM project_company pc JOIN md_company c ON c.id = pc.company_id
       WHERE pc.project_id = ?
       ORDER BY CASE pc.role WHEN 'target' THEN 0 ELSE 1 END, c.name_ko`,
    )
    .all(project.id);
  const proj = db.query("SELECT company_id FROM md_project WHERE id = ?").get(project.id) as { company_id: string | null } | null;
  return ok({ targets, primary_target_id: proj?.company_id ?? null }, 200, { count: targets.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "대상 기업 관리는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();

  const body = (await request.json().catch(() => null)) as {
    action?: "add_candidates" | "promote_to_shortlist" | "set_primary";
    names?: string[];
    company_name?: string;
    company_id?: string;
  } | null;
  if (!body?.action) return badRequest("invalid_request", "action is required.");

  const db = getDb();
  const now = new Date().toISOString();

  if (body.action === "add_candidates") {
    const names = (body.names ?? []).map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) return badRequest("names_required", "후보 기업명(names)이 필요합니다.");
    let added = 0;
    for (const name of names) {
      let c = db.query("SELECT id FROM md_company WHERE name_ko = ?").get(name) as { id: string } | null;
      if (!c) {
        const cid = ulid();
        db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [cid, name, now]);
        c = { id: cid };
      }
      db.run(
        `INSERT OR IGNORE INTO project_company (id, project_id, company_id, role, created_at) VALUES (?,?,?,?,?)`,
        [ulid(), project.id, c.id, "candidate", now],
      );
      added++;
    }
    return ok({ added }, 201, { action: "add_candidates" });
  }

  if (body.action === "promote_to_shortlist") {
    const companyId = body.company_id?.trim();
    if (!companyId) return badRequest("company_id_required", "company_id is required.");
    db.run(
      `INSERT INTO project_company (id, project_id, company_id, role, created_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(project_id, company_id, role) DO NOTHING`,
      [ulid(), project.id, companyId, "target", now],
    );
    return ok({ company_id: companyId, role: "target" }, 200, { action: "promote_to_shortlist" });
  }

  if (body.action === "set_primary") {
    const companyId = body.company_id?.trim();
    if (!companyId) return badRequest("company_id_required", "company_id is required.");
    const known = db
      .query("SELECT id FROM project_company WHERE project_id = ? AND company_id = ?")
      .get(project.id, companyId);
    if (!known) return badRequest("unknown_candidate", "후보 목록에 없는 기업입니다 — 먼저 Long List에 추가하세요.");
    db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [companyId, project.id]);
    return ok({ primary_target_id: companyId }, 200, { action: "set_primary" });
  }

  return badRequest("unknown_action", "action must be add_candidates | promote_to_shortlist | set_primary.");
}
