// brownfield-eval-confirm.ts — the ONLY path that turns a draft version into recorded eval states (ADR-0199 decision 6,
// design §4 A6, boundary #2). Human-only at the route; this function never runs for an agent principal.
//
// Rules (all in one transaction):
//   1. the version must be the latest for its candidate and category (409 stale_version);
//   2. only criteria whose CURRENT state is pending (or missing) are written — a person's verdict is never overwritten
//      (skipped `already_judged`); the state is re-read inside the synchronous transaction, so a concurrent human save
//      that landed first wins;
//   3. `확인 안됨` items (proposed_status null) are never written (skipped `unverified`);
//   4. a criterion that is deleted, retired or whose rubric differs from the version's criteria_snapshot is skipped
//      `criterion_changed`;
//   5. each write goes through upsertEvalState with assessed_by = the caller, note = the proposal note,
//      evidence_ref = the version id, confirmed_from_version_id = the version; then invalidateTargetJudgements runs once
//      (ADR-0171 parity with the single PUT path).
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../../db/lib/access-control.ts";
import {
  canonicalJson,
  evalDraftPayloadSchema,
  getLatestVersion,
  getVersion,
  type EvalDraftCategory,
} from "../../../db/repositories/brownfield-eval-draft.repository.ts";
import { invalidateTargetJudgements } from "./brownfield-capability-judgement.ts";
import {
  computeEvalScore,
  targetEvalStates,
  upsertEvalState,
  type EvalCategoryScore,
} from "./brownfield-eval-criteria.ts";

export type ConfirmSkipReason = "already_judged" | "unverified" | "criterion_changed" | "not_in_version";

export type ConfirmOutcome =
  | {
      ok: true;
      category: EvalDraftCategory;
      version_no: number;
      confirmed: number;
      skipped: Array<{ criterion_id: string; reason: ConfirmSkipReason }>;
      scores: Record<EvalDraftCategory, EvalCategoryScore>;
    }
  | { ok: false; status: 400 | 404 | 409; code: string; message: string };

export function confirmFromVersion(
  db: Database,
  input: {
    oppId: string;
    targetId: string;
    versionId: string;
    criterionIds: string[] | null;
    actor: string;
    via: string;
  },
): ConfirmOutcome {
  const target = db
    .query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(input.targetId, input.oppId) as { id: string } | null;
  if (!target) return { ok: false, status: 404, code: "not_found", message: "Not found." };
  const version = getVersion(db, input.versionId);
  if (!version || version.brownfield_target_id !== input.targetId)
    return { ok: false, status: 404, code: "not_found", message: "Not found." };
  const latest = getLatestVersion(db, input.targetId, version.category);
  if (!latest || latest.id !== version.id) {
    return {
      ok: false,
      status: 409,
      code: "stale_version",
      message: `v${version.version_no} is no longer the latest ${version.category} draft — review the newer version before confirming.`,
    };
  }
  let payload: ReturnType<typeof evalDraftPayloadSchema.parse>;
  try {
    payload = evalDraftPayloadSchema.parse(JSON.parse(version.payload));
  } catch {
    return { ok: false, status: 409, code: "payload_invalid", message: "The draft payload could not be read." };
  }
  const wanted = input.criterionIds ? new Set(input.criterionIds) : null;

  const result = db.transaction(() => {
    const at = new Date().toISOString();
    const criteria = new Map(
      (
        db
          .query(
            "SELECT id, rubric_json, deleted_at, retired_at FROM brownfield_eval_criterion WHERE opportunity_id = ?",
          )
          .all(input.oppId) as Array<{
          id: string;
          rubric_json: string | null;
          deleted_at: string | null;
          retired_at: string | null;
        }>
      ).map((c) => [c.id, c] as const),
    );
    const snapshot = new Map(payload.criteria_snapshot.map((c) => [c.criterion_id, c] as const));
    const inVersion = new Set(payload.items.map((i) => i.criterion_id));
    const skipped: Array<{ criterion_id: string; reason: ConfirmSkipReason }> = [];
    let confirmed = 0;

    for (const id of wanted ?? []) if (!inVersion.has(id)) skipped.push({ criterion_id: id, reason: "not_in_version" });

    for (const item of payload.items) {
      if (wanted && !wanted.has(item.criterion_id)) continue;
      if (item.proposed_status === null) {
        skipped.push({ criterion_id: item.criterion_id, reason: "unverified" });
        continue;
      }
      const crit = criteria.get(item.criterion_id);
      const snap = snapshot.get(item.criterion_id);
      let currentRubric: unknown = null;
      try {
        currentRubric = crit?.rubric_json ? JSON.parse(crit.rubric_json) : null;
      } catch {
        currentRubric = null;
      }
      if (
        !crit ||
        crit.deleted_at ||
        crit.retired_at ||
        !snap ||
        canonicalJson(currentRubric) !== canonicalJson(snap.rubric)
      ) {
        skipped.push({ criterion_id: item.criterion_id, reason: "criterion_changed" });
        continue;
      }
      const state = db
        .query("SELECT status FROM brownfield_target_eval_state WHERE brownfield_target_id = ? AND criterion_id = ?")
        .get(input.targetId, item.criterion_id) as { status: string } | null;
      if (state && state.status !== "pending") {
        skipped.push({ criterion_id: item.criterion_id, reason: "already_judged" });
        continue;
      }
      upsertEvalState(input.targetId, item.criterion_id, {
        status: item.proposed_status,
        note: item.note,
        evidence_ref: version.id,
        assessedBy: input.actor,
        confirmedFromVersionId: version.id,
      });
      confirmed++;
    }
    if (confirmed > 0) invalidateTargetJudgements(db, input.targetId, input.actor, at);
    appendAudit(db, {
      actor: input.actor,
      action: "target_eval.confirm_from_version",
      target: `${input.oppId}:${input.targetId}:${version.category}:v${version.version_no}:confirmed=${confirmed}:via=${input.via}`,
      now: at,
    });
    return { confirmed, skipped };
  })();

  const scores = computeEvalScore(targetEvalStates(input.oppId, input.targetId, input.actor));
  return { ok: true, category: version.category, version_no: version.version_no, ...result, scores };
}
