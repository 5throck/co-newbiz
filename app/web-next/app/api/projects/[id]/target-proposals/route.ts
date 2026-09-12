import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET/POST /api/projects/[id]/target-proposals — S6 candidate discovery (B1).
// GET: deterministic suggestions from md_company sharing the deal's industry
// keyword, minus already-registered candidates. POST: accept a suggestion (or
// register manually) → creates a brownfield_target with discovery_source
// provenance (data contract A1/A2). Web-search proposals are a later wave and
// will always carry the LLM-proposal label + evidence (ADR-0118).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  const db = getDb();
  const bound = db.query(
    `SELECT i.id AS industry_id, i.name_ko FROM project_industry pi
     JOIN md_industry i ON i.id = pi.industry_id WHERE pi.project_id = ? LIMIT 1`,
  ).get(id) as { industry_id: string; name_ko: string } | undefined;
  const existing = db.query(
    "SELECT company_name FROM brownfield_target WHERE opportunity_id = (SELECT source_opportunity_id FROM md_project WHERE id = ?)",
  ).all(id) as Array<{ company_name: string }>;
  const names = new Set(existing.map((e) => e.company_name));
  const root = bound ? bound.name_ko.replace(/ 제조| 업| 서비스/g, "").slice(0, 2) : null;
  const suggestions = root
    ? (db.query("SELECT id, name_ko, dart_corp_code FROM md_company WHERE name_ko LIKE ? ORDER BY name_ko LIMIT 20")
        .all(`%${root}%`) as Array<{ id: string; name_ko: string; dart_corp_code: string | null }>)
        .filter((c) => !names.has(c.name_ko))
    : [];
  return ok({ industry: bound ?? null, suggestions, registered: existing.length }, 200, { suggestions: suggestions.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "후보 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    company_name?: string; dart_corp_code?: string | null; discovery_source?: string;
    universe_note?: string | null;
  } | null;
  if (!body?.company_name?.trim()) return badRequest("company_required", "company_name은 필수입니다.");
  const source = body.discovery_source?.trim() || "manual";
  if (!["manual", "master_proposal", "web_proposal"].includes(source)) {
    return badRequest("invalid_source", "discovery_source는 manual | master_proposal | web_proposal 중 하나입니다.");
  }
  const db = getDb();
  const opp = db.query("SELECT source_opportunity_id FROM md_project WHERE id = ?").get(id) as
    | { source_opportunity_id: string | null }
    | undefined;
  if (!opp?.source_opportunity_id) return badRequest("not_promoted", "기회에서 승격된 프로젝트에만 후보를 등록할 수 있습니다.");
  const now = new Date().toISOString();
  const rid = ulid();
  db.run(
    `INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, universe_note, discovery_source, proposal_accepted_at, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)`,
    [rid, opp.source_opportunity_id, body.company_name.trim(), body.dart_corp_code?.trim() || null,
     body.universe_note?.trim() || null, source, now, now, now],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "target_proposal.accept", target: `${id}:${rid}`, now });
  return ok({ id: rid, discovery_source: source }, 201);
}
