// ADR-0129 — 가치사슬 연계(proxy_link) 개별 링크 수정. 두 가지 상호 배타적
// 요청 형태를 지원한다:
//   1) 은퇴(retire): { status: 'retired', rationale }  — 하드 삭제 대신
//      status/retired_at/retired_by를 남겨 감사 추적을 유지한다.
//   2) 레거시 relation 태깅: { relation }만 — relation IS NULL인 구
//      structural 행(ADR-0126 시절 등록, relation 미태깅)에 대해서만 허용.
//      source는 바꾸지 않는다(이미 사람이 승인했던 행이라는 사실은 유지).
// 두 형태 모두 아닌 본문은 400. 이미 은퇴된 행을 다시 은퇴하거나, 이미
// relation이 있는 행에 relation을 덮어쓰려는 시도도 400 — 덮어쓰기 대신
// 은퇴 후 재등록을 쓰라는 의도적 제약이다(ADR-0129 §Decision 4).
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { route } from "../../../../../../../lib/route.ts";

type Relation = "전방" | "전전방" | "후방" | "후후방";
const RELATION_TO_HOP_DISTANCE: Record<Relation, 1 | 2> = {
  "전방": 1,
  "전전방": 2,
  "후방": 1,
  "후후방": 2,
};

interface ProxyLinkRow {
  id: string;
  from_industry_id: string;
  to_industry_id: string;
  relation: string | null;
  status: string;
}

export const PATCH = route(
  async (request: Request, { params }: { params: Promise<{ industryId: string; linkId: string }> }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    const ctx = auth.auth;
    if (ctx.role === "viewer") return forbidden("role_required", "가치사슬 연계 수정은 analyst 역할 이상이어야 합니다.");
    const { industryId, linkId } = await params;
    const db = getDb();

    const link = db
      .query(
        "SELECT id, from_industry_id, to_industry_id, relation, status FROM proxy_link WHERE id = ? AND (from_industry_id = ? OR to_industry_id = ?)",
      )
      .get(linkId, industryId, industryId) as ProxyLinkRow | null;
    if (!link) return notFound();

    const body = (await request.json().catch(() => null)) as {
      status?: string; rationale?: string; relation?: string;
    } | null;
    if (!body) return badRequest("invalid_request", "요청 본문이 필요합니다.");

    const now = new Date().toISOString();

    // 형태 1: 은퇴
    if (body.status !== undefined) {
      if (body.status !== "retired") return badRequest("invalid_request", "status는 'retired'만 지원합니다.");
      if (link.status === "retired") return badRequest("already_retired", "이미 은퇴된 링크입니다.");
      const rationale = body.rationale?.trim();
      if (!rationale) return badRequest("invalid_request", "은퇴에는 rationale이 필요합니다.");

      db.run(
        "UPDATE proxy_link SET status = 'retired', retired_at = ?, retired_by = ? WHERE id = ?",
        [now, ctx.userId, linkId],
      );
      appendAudit(db, {
        actor: ctx.userId,
        action: "proxy_link_retire",
        target: `${link.from_industry_id}->${link.to_industry_id}: ${rationale}`,
        now,
      });
      return ok({ id: linkId, status: "retired", retired_at: now, retired_by: ctx.userId }, 200);
    }

    // 형태 2: 레거시 relation 태깅
    if (body.relation !== undefined) {
      const relation = body.relation as Relation;
      if (!(relation in RELATION_TO_HOP_DISTANCE)) {
        return badRequest("invalid_request", "relation은 전방 | 전전방 | 후방 | 후후방 중 하나입니다.");
      }
      if (link.relation !== null) {
        return badRequest(
          "relation_already_set",
          "이미 relation이 설정된 링크입니다 — 덮어쓰는 대신 은퇴 후 재등록하세요.",
        );
      }
      const hopDistance = RELATION_TO_HOP_DISTANCE[relation];
      db.run("UPDATE proxy_link SET relation = ?, hop_distance = ? WHERE id = ?", [relation, hopDistance, linkId]);
      appendAudit(db, {
        actor: ctx.userId,
        action: "proxy_link_relation_tag",
        target: `${link.from_industry_id}->${link.to_industry_id}: ${relation}`,
        now,
      });
      return ok({ id: linkId, relation, hop_distance: hopDistance }, 200);
    }

    return badRequest("invalid_request", "status(retired) 또는 relation 중 하나가 필요합니다.");
  },
);
