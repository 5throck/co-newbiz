// 경쟁사 등록 (md_company 주체) — member 라우트와 동일 계약(ADR-0142).
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { resolveCompanySubject } from "../../../../../lib/company-profile-pipeline.ts";
import { listConfirmedCompetitors, registerCompetitor } from "../../../../../lib/company-competitors.ts";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { companyId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM md_company WHERE id = ?").get(companyId)) return notFound();
  const url = new URL(request.url);
  if (url.searchParams.get("includeExcluded") === "1") {
    const all = db
      .query(
        `SELECT * FROM company_competitor WHERE company_id = ? ORDER BY status DESC, proposal_accepted_at ASC, name ASC`,
      )
      .all(companyId);
    return ok({ competitors: all });
  }
  return ok({ competitors: listConfirmedCompetitors(db, resolveCompanySubject(db, companyId)) });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "경쟁사 등록은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { companyId } = await params;
  const body = (await request.json().catch(() => null)) as {
    name?: string; dart_corp_code?: string | null; note?: string | null;
    discovery_source?: string;
    evidence?: Array<{ title: string | null; url: string }> | null;
  } | null;
  if (!body?.name?.trim()) return badRequest("name_required", "경쟁사명은 필수입니다.");
  const source = body.discovery_source?.trim() || "manual";
  if (!["manual", "ai_proposal"].includes(source)) {
    return badRequest("invalid_source", "discovery_source는 manual | ai_proposal 중 하나입니다.");
  }
  const db = getDb();
  if (!db.query("SELECT id FROM md_company WHERE id = ?").get(companyId)) return notFound();
  try {
    const result = registerCompetitor(
      db,
      resolveCompanySubject(db, companyId),
      {
        name: body.name,
        dart_corp_code: body.dart_corp_code ?? null,
        note: body.note ?? null,
        discovery_source: source as "manual" | "ai_proposal",
        // 웹검색 제안 수용 시 근거 URL을 행에 스냅샷한다 (payload에 없는 후보).
        evidence: Array.isArray(body.evidence) ? body.evidence : null,
      },
      auth.auth.userId,
    );
    return ok(result, 201);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "duplicate_competitor") return badRequest("duplicate_competitor", (err as Error).message);
    if (code === "name_required") return badRequest("name_required", (err as Error).message);
    throw err;
  }
}
