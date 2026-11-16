// S7 후보 1건의 재무·기술 평가 판정 1건 upsert (ADR-0139). DART 참고값은
// 표시용일 뿐 — 판정은 항상 사람이 입력한다.
import { getDb } from "../../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../../db/lib/access-control.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../../../lib/envelope.ts";
import { upsertEvalState } from "../../../../../../../../lib/brownfield-eval-criteria.ts";
import { invalidateTargetJudgements } from "../../../../../../../../lib/brownfield-capability-judgement.ts";
import { getVersion } from "../../../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";

const STATUSES = new Set(["pending", "pass", "partial", "fail", "na", "waived"]);

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ oppId: string; targetId: string; criterionId: string }> },
) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Evaluation judgements require the analyst role or higher.",
  });
  if (denied) return denied;
  const { oppId, targetId, criterionId } = await params;
  const db = getDb();
  const target = db
    .query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, oppId) as { id: string } | undefined;
  if (!target) return notFound();
  const criterion = db
    .query(
      "SELECT id, category FROM brownfield_eval_criterion WHERE id = ? AND opportunity_id = ? AND deleted_at IS NULL AND retired_at IS NULL",
    )
    .get(criterionId, oppId) as { id: string; category: string } | undefined;
  if (!criterion) return notFound();
  const body = (await request.json().catch(() => null)) as {
    status?: string;
    note?: string;
    evidence_ref?: string;
    confirmed_from_version_id?: unknown;
  } | null;
  if (!body?.status || !STATUSES.has(body.status)) {
    return badRequest("invalid_request", `status must be one of: ${[...STATUSES].join(" | ")}.`);
  }
  // ADR-0199 A7: an edited draft saved by a person records the draft it rested on, even if the saved status differs from
  // the proposal. A save without the field writes NULL (the verdict no longer rests on a draft).
  // The link is a human act: this route is reachable by agents (record_candidate_screening), so an agent/bearer/MCP
  // caller supplying it is refused rather than silently ignored — it can never become an agent-made confirmation.
  let fromVersion: string | null = null;
  if (body.confirmed_from_version_id != null) {
    const humanDenied = humanOnlyDenied(
      auth.auth,
      "초안 근거 연결(confirmed_from_version_id)은 사람만 기록할 수 있습니다 (boundary #2).",
    );
    if (humanDenied) return humanDenied;
    if (typeof body.confirmed_from_version_id !== "string")
      return badRequest("invalid_request", "confirmed_from_version_id must be a string.");
    const v = getVersion(db, body.confirmed_from_version_id);
    let inPayload = false;
    if (v) {
      try {
        inPayload =
          (JSON.parse(v.payload) as { items?: Array<{ criterion_id?: string }> }).items?.some(
            (i) => i.criterion_id === criterionId,
          ) === true;
      } catch {
        inPayload = false;
      }
    }
    if (!v || v.brownfield_target_id !== targetId || v.category !== criterion.category || !inPayload)
      return badRequest(
        "invalid_request",
        "confirmed_from_version_id must be a draft version of this candidate and category that proposes this criterion.",
      );
    fromVersion = v.id;
  }
  const state = upsertEvalState(targetId, criterionId, {
    status: body.status as "pending" | "pass" | "partial" | "fail" | "na" | "waived",
    note: body.note?.trim() || null,
    evidence_ref: body.evidence_ref?.trim() || null,
    assessedBy: auth.auth.userId,
    confirmedFromVersionId: fromVersion,
  });
  if (fromVersion) {
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "target_eval.edit_from_version",
      target: `${oppId}:${targetId}:${criterionId}:version=${fromVersion}:via=${callPathOf(auth.auth)}`,
      now: state.assessed_at,
    });
  }
  // ADR-0171: a changed verdict on a seeded criterion invalidates only THIS target's capability
  // judgement for that row (history kept, confirmation cleared), under the calling user.
  db.transaction(() => {
    invalidateTargetJudgements(db, targetId, auth.auth.userId, state.assessed_at);
  })();
  return ok(state, 200);
}
