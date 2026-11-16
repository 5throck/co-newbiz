// S7 후보 1건의 재무·기술 평가 판정 1건 upsert (ADR-0139, origin rules ADR-0200 §4.1).
//
// Origin (`verdict_source`) is derived from the CALLER, never from the body (a body `verdict_source` is 400):
//   - a human UI session (humanOnlyDenied(...) === null) stores `human` — always lands, even over a human verdict, and a
//     save of an AI verdict with the same status still turns it `human` (review, G5);
//   - MCP (record_candidate_screening), the stdio MCP REST client, bearer tokens and agent accounts store `ai_draft`
//     (Q5). They can never overwrite a human verdict (409 human_verdict_locked, Q8) and can never set na/waived
//     (403 human_only, Q8: excluding a criterion changes the score denominator).
//   - `source_version_id` (deprecated alias `confirmed_from_version_id`) is human only (403 human_only for others).
//
// note / evidence_ref rule: when the saved status equals the stored status and note / evidence_ref are OMITTED from the
// body, the stored values are preserved (a bare `확인` save must not change what the ADR-0171 capability-judgement eval
// hash covers — status + note + evidence_ref). Sending a key (even "") overwrites it; a status change with the keys
// omitted clears them, as before. The same rule keeps the stored `source_version_id` for an unchanged-status human save.
import { getDb } from "../../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../../db/lib/access-control.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../../../lib/envelope.ts";
import { recordEvalVerdict, type EvalStatus } from "../../../../../../../../lib/brownfield-eval-criteria.ts";
import { invalidateTargetJudgements } from "../../../../../../../../lib/brownfield-capability-judgement.ts";
import {
  getEvalVerdict,
  getVersion,
  HUMAN_ONLY_VERDICT_STATUSES,
  isUnreviewedVerdict,
} from "../../../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";

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
    source_version_id?: unknown;
    confirmed_from_version_id?: unknown;
    verdict_source?: unknown;
  } | null;
  if (!body?.status || !STATUSES.has(body.status)) {
    return badRequest("invalid_request", `status must be one of: ${[...STATUSES].join(" | ")}.`);
  }
  // The origin is the server's to derive (§4.1 rule 1).
  if (body.verdict_source !== undefined)
    return badRequest("invalid_request", "verdict_source cannot be set by the caller; the server derives it.");
  const status = body.status as EvalStatus;
  const human = humanOnlyDenied(auth.auth, "") === null;
  const via = callPathOf(auth.auth);

  // ADR-0200 Q8: a non-human caller can neither exclude a criterion from the score nor mark a verdict as resting on a
  // reviewed draft.
  if (!human && (HUMAN_ONLY_VERDICT_STATUSES as readonly string[]).includes(status)) {
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "target_eval.agent_verdict.refused",
      target: `${oppId}:${targetId}:${criterionId}:reason=forbidden_status:via=${via}`,
      now: new Date().toISOString(),
    });
    return forbidden(
      "human_only",
      "na/waived exclude a criterion from the score: only a person can set them (boundary #2).",
    );
  }
  const requestedVersion = body.source_version_id ?? body.confirmed_from_version_id;
  let fromVersion: string | null = null;
  if (requestedVersion != null) {
    if (!human)
      return forbidden("human_only", "초안 근거 연결(source_version_id)은 사람만 기록할 수 있습니다 (boundary #2).");
    if (typeof requestedVersion !== "string")
      return badRequest("invalid_request", "source_version_id must be a string.");
    const v = getVersion(db, requestedVersion);
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
        "source_version_id must be a draft version of this candidate and category that proposes this criterion.",
      );
    fromVersion = v.id;
  }

  const previous = getEvalVerdict(db, targetId, criterionId);
  const unchanged = previous?.status === status;
  const note = typeof body.note === "string" ? body.note.trim() || null : unchanged ? (previous?.note ?? null) : null;
  const evidenceRef =
    typeof body.evidence_ref === "string"
      ? body.evidence_ref.trim() || null
      : unchanged
        ? (previous?.evidence_ref ?? null)
        : null;
  const sourceVersionId = human ? (fromVersion ?? (unchanged ? (previous?.source_version_id ?? null) : null)) : null;

  const res = recordEvalVerdict(targetId, criterionId, {
    status,
    note,
    evidence_ref: evidenceRef,
    assessedBy: auth.auth.userId,
    source: human ? "human" : "ai_draft",
    sourceVersionId,
  });
  const at = new Date().toISOString();
  if (!res.ok) {
    if (res.reason === "human_verdict_locked") {
      appendAudit(db, {
        actor: auth.auth.userId,
        action: "target_eval.agent_verdict.refused",
        target: `${oppId}:${targetId}:${criterionId}:reason=human_verdict_locked:via=${via}`,
        now: at,
      });
      return fail(409, "human_verdict_locked", "A person already judged this item; only a person can change it.");
    }
    return forbidden(
      "human_only",
      "na/waived exclude a criterion from the score: only a person can set them (boundary #2).",
    );
  }
  const state = res.row;
  if (human) {
    if (isUnreviewedVerdict(res.previous)) {
      appendAudit(db, {
        actor: auth.auth.userId,
        action: "target_eval.ai_verdict.review",
        target: `${oppId}:${targetId}:${criterionId}:from=${(res.previous as { verdict_source: string }).verdict_source}:version=${res.previous?.source_version_id ?? "none"}:changed=${res.previous?.status === status ? 0 : 1}`,
        now: state.assessed_at,
      });
    }
  } else {
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "target_eval.agent_verdict",
      target: `${oppId}:${targetId}:${criterionId}:via=${via}`,
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
