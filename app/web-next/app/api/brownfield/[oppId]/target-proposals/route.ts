import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";

// GET/POST /api/brownfield/[oppId]/target-proposals — S6 candidate discovery.
// Keyed by OPPORTUNITY id: the /brownfield screen works pre-promotion (a
// brownfield_target row exists before any md_project does, S7→S8 promotion is
// what creates the project), so the previous /api/projects/[id] keying made
// both endpoints unreachable exactly when S6 runs — GET always 404'd
// (visibleProject → null) and POST rejected with not_promoted.
// GET: deterministic suggestions from md_company sharing the deal's industry
// keyword, minus already-registered candidates. POST: accept a suggestion (or
// register manually) → creates a brownfield_target with discovery_source
// provenance (data contract A1/A2). Web-search proposals carry the
// LLM-proposal label + evidence (ADR-0118) — see ../web-search/route.ts.

interface OppRow {
  id: string;
  market_scope: string | null;
}

/** 산업 컨텍스트 — opportunity.market_scope는 S1 산업명을 갖는다(정확 일치
 * 우선, 없으면 접두 매칭). project_industry는 승격 전에는 존재하지 않는다. */
function findIndustry(db: ReturnType<typeof getDb>, opp: OppRow) {
  if (!opp.market_scope) return null;
  const exact = db
    .query("SELECT id, name_ko FROM md_industry WHERE name_ko = ? LIMIT 1")
    .get(opp.market_scope) as { id: string; name_ko: string } | undefined;
  if (exact) return exact;
  return (
    db
      .query("SELECT id, name_ko FROM md_industry WHERE name_ko LIKE ? ORDER BY name_ko LIMIT 1")
      .get(`%${opp.market_scope.replace(/%|_/g, "")}%`) as { id: string; name_ko: string } | undefined
  ) ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { oppId } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, market_scope FROM opportunity WHERE id = ?").get(oppId) as OppRow | undefined;
  if (!opp) return notFound();
  const bound = findIndustry(db, opp);
  const existing = db.query("SELECT company_name FROM brownfield_target WHERE opportunity_id = ?").all(oppId) as Array<{ company_name: string }>;
  const names = new Set(existing.map((e) => e.company_name));
  const root = bound ? bound.name_ko.replace(/ 제조| 업| 서비스/g, "").slice(0, 2) : null;
  const suggestions = root
    ? (db.query("SELECT id, name_ko, dart_corp_code FROM md_company WHERE name_ko LIKE ? ORDER BY name_ko LIMIT 20")
        .all(`%${root}%`) as Array<{ id: string; name_ko: string; dart_corp_code: string | null }>)
        .filter((c) => !names.has(c.name_ko))
    : [];
  return ok({ industry: bound ?? null, suggestions, registered: existing.length }, 200, { suggestions: suggestions.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "후보 등록은 analyst 역할 이상이어야 합니다.");
  const { oppId } = await params;
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
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  const dup = db
    .query("SELECT id FROM brownfield_target WHERE opportunity_id = ? AND company_name = ? AND status != 'excluded'")
    .get(oppId, body.company_name.trim()) as { id: string } | undefined;
  if (dup) return badRequest("duplicate_target", `'${body.company_name.trim()}'은(는) 이미 Long List에 있습니다.`);
  const now = new Date().toISOString();
  const rid = ulid();
  db.run(
    `INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, universe_note, discovery_source, proposal_accepted_at, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)`,
    [rid, oppId, body.company_name.trim(), body.dart_corp_code?.trim() || null,
     body.universe_note?.trim() || null, source, now, now, now],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "target_proposal.accept", target: `${oppId}:${rid}`, now });
  return ok({ id: rid, discovery_source: source }, 201);
}
