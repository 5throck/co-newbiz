// S3 연계 시너지 — 사람이 추가하는 영역 (ADR-0125). LLM 파이프라인 출력
// (synergy_version.payload)은 append-only 스냅샷이라 직접 고칠 수 없으므로,
// 사람이 놓친 영역을 추가로 등록할 수 있게 별도 테이블에 쌓는다. origin은
// 늘 human — LLM 제안은 payload에서, 사람 추가는 이 테이블에서 온다.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "연계 시너지 영역 추가는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const db = getDb();
  const analysis = db.query("SELECT id FROM synergy_analysis WHERE id = ?").get(id) as { id: string } | null;
  if (!analysis) return notFound();

  const body = (await request.json().catch(() => null)) as {
    area?: string; synergyType?: string; rationale?: string; opportunity?: string; risk?: string; sources?: string[];
  } | null;
  const area = body?.area?.trim();
  const synergyType = body?.synergyType?.trim();
  const rationale = body?.rationale?.trim();
  if (!area) return badRequest("invalid_request", "area는 필수입니다.");
  if (!synergyType) return badRequest("invalid_request", "synergyType은 필수입니다.");
  if (!rationale) return badRequest("invalid_request", "rationale은 필수입니다.");

  const now = new Date().toISOString();
  const itemId = ulid();
  db.run(
    `INSERT INTO synergy_linkage_item (id, analysis_id, area, synergy_type, rationale, opportunity, risk, sources_json, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [itemId, id, area, synergyType, rationale, body?.opportunity?.trim() ?? null, body?.risk?.trim() ?? null,
      Array.isArray(body?.sources) ? JSON.stringify(body.sources) : null, ctx.userId, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "synergy.linkage_item_add", target: `${id}:${area}`, now });
  return ok({ id: itemId }, 201);
});
