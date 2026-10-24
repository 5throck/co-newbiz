// 경쟁사 등록 — 제안 수용(discovery_source=ai_proposal) 또는 수작업 등록
// (manual). 확정 행은 이 사람의 행위로만 생긴다(ADR-0142 경계 #2).
import { authenticate, requireBusinessActor } from '../../../../../../lib/auth.ts';
import { badRequest, notFound, ok } from '../../../../../../lib/envelope.ts';
import { getDb } from '../../../../../../../../db/client.ts';
import { resolveMemberSubject } from '../../../../../../lib/company-profile-pipeline.ts';
import { listConfirmedCompetitors, registerCompetitor } from '../../../../../../lib/company-competitors.ts';

export async function GET(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { memberId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM company_group_member WHERE id = ?").get(memberId)) return notFound();
  return ok({ competitors: listConfirmedCompetitors(db, resolveMemberSubject(db, memberId)) });
}

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Registering competitors requires the analyst role or higher." });
  if (denied) return denied;
  const { memberId } = await params;
  const body = (await request.json().catch(() => null)) as {
    name?: string; dart_corp_code?: string | null; note?: string | null;
    discovery_source?: string;
    evidence?: Array<{ title: string | null; url: string }> | null;
  } | null;
  if (!body?.name?.trim()) return badRequest("name_required", "Competitor name is required.");
  const source = body.discovery_source?.trim() || "manual";
  if (!["manual", "ai_proposal"].includes(source)) {
    return badRequest("invalid_source", "discovery_source must be one of: manual | ai_proposal.");
  }
  const db = getDb();
  if (!db.query("SELECT id FROM company_group_member WHERE id = ?").get(memberId)) return notFound();
  try {
    const result = registerCompetitor(
      db,
      resolveMemberSubject(db, memberId),
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
