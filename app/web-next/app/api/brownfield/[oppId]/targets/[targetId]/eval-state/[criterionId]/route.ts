// S7 후보 1건의 재무·기술 평가 판정 1건 upsert (ADR-0139). DART 참고값은
// 표시용일 뿐 — 판정은 항상 사람이 입력한다.
import { getDb } from "../../../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../../../lib/envelope.ts";
import { upsertEvalState } from "../../../../../../../../lib/brownfield-eval-criteria.ts";

const STATUSES = new Set(["pending", "pass", "partial", "fail", "na", "waived"]);

export async function PUT(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string; criterionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "평가 판정은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { oppId, targetId, criterionId } = await params;
  const db = getDb();
  const target = db.query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ?").get(targetId, oppId) as { id: string } | undefined;
  if (!target) return notFound();
  const criterion = db.query("SELECT id FROM brownfield_eval_criterion WHERE id = ? AND opportunity_id = ? AND deleted_at IS NULL").get(criterionId, oppId) as { id: string } | undefined;
  if (!criterion) return notFound();
  const body = (await request.json().catch(() => null)) as { status?: string; note?: string; evidence_ref?: string } | null;
  if (!body?.status || !STATUSES.has(body.status)) {
    return badRequest("invalid_request", `status는 ${[...STATUSES].join(" | ")} 중 하나입니다.`);
  }
  const state = upsertEvalState(targetId, criterionId, {
    status: body.status as "pending" | "pass" | "partial" | "fail" | "na" | "waived",
    note: body.note?.trim() || null,
    evidence_ref: body.evidence_ref?.trim() || null,
    assessedBy: auth.auth.userId,
  });
  return ok(state, 200);
}
