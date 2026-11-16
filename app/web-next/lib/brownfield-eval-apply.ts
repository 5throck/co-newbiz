// brownfield-eval-apply.ts — ADR-0200 direct apply (spec 2026-11-17-s6-direct-ai-verdict §4.2/§4.3).
//
// `applyVersionToEvalState` turns one immutable draft version's proposals into item verdicts that carry their origin:
// financial → `auto_rule`, technical → `ai_draft`. It is meant to run as the `apply` hook of `commitCategoryDraft`
// (db/repositories/brownfield-eval-draft.repository.ts), i.e. inside the SAME transaction as the version insert or the
// `unchanged` decision. It is idempotent: applying the same version twice rewrites identical status/note/evidence_ref.
//
// Per item (§4.2 table):
//   criterion deleted / retired since the snapshot            → skip `criterion_retired`
//   rubric (financial) or label (technical) differs, or the
//   criterion is missing from the snapshot / other category   → skip `criterion_changed`
//   human, non-pending                                         → never written (`kept_human`)
//   no row / pending, proposal pass|partial|fail               → write (`applied`)
//   no row / pending, proposal null (확인 안됨)                 → nothing written (`unverified`)
//   non-human non-pending, proposal pass|partial|fail          → overwrite (`applied`); evidence_ref stays stable when the
//                                                                status is unchanged (judgement hash, defect b)
//   non-human non-pending, proposal null                       → reset to pending (`cleared`, Q2)
// Every write goes through `writeEvalVerdict`, whose SQL guard refuses to replace a human verdict even if one landed
// after the read (counted `kept_human`). Afterwards ADR-0171 judgement invalidation runs once under the run actor, and
// the `target_eval.ai_verdict.apply` audit event is appended (§4.4) — both inside the caller's transaction.
import type { Database } from "bun:sqlite";
import { appendAudit } from "../../../db/lib/access-control.ts";
import {
  canonicalJson,
  evalDraftPayloadSchema,
  EvalDraftError,
  getEvalVerdict,
  isHumanJudged,
  verdictSourceForCategory,
  writeEvalVerdict,
  type CategoryApplySummary,
  type DraftVersionRow,
  type EvalDraftPayload,
} from "../../../db/repositories/brownfield-eval-draft.repository.ts";
import { invalidateTargetJudgements } from "./brownfield-capability-judgement.ts";

export interface ApplyVersionInput {
  version: DraftVersionRow;
  /** The run actor (`resumed_by ?? started_by`): accountable, never the judge (§3.2). */
  actor: string;
  now: string;
  /** The run doing the apply, for the audit target. Defaults to the version's run (differs on the `unchanged` path). */
  runId?: string | null;
}

/** Same rubric reading as the engine's criteria snapshot: a JSON object, or null. */
function rubricOf(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface LiveCriterion {
  id: string;
  category: string;
  label: string;
  rubric_json: string | null;
  deleted_at: string | null;
  retired_at: string | null;
}

export function applyVersionToEvalState(db: Database, input: ApplyVersionInput): CategoryApplySummary {
  const { version, actor, now } = input;
  if (!actor) throw new EvalDraftError("invalid", "actor is required.");
  let payload: EvalDraftPayload;
  try {
    payload = evalDraftPayloadSchema.parse(JSON.parse(version.payload));
  } catch {
    throw new EvalDraftError("invalid", `Draft version '${version.id}' payload could not be read.`);
  }
  const category = version.category;
  const source = verdictSourceForCategory(category);

  return db.transaction((): CategoryApplySummary => {
    const target = db
      .query("SELECT opportunity_id FROM brownfield_target WHERE id = ?")
      .get(version.brownfield_target_id) as { opportunity_id: string } | null;
    if (!target) throw new EvalDraftError("not_found", `Target '${version.brownfield_target_id}' not found.`);
    const criteria = new Map(
      (
        db
          .query(
            "SELECT id, category, label, rubric_json, deleted_at, retired_at FROM brownfield_eval_criterion WHERE opportunity_id = ?",
          )
          .all(target.opportunity_id) as LiveCriterion[]
      ).map((c) => [c.id, c] as const),
    );
    const snapshot = new Map(payload.criteria_snapshot.map((c) => [c.criterion_id, c] as const));
    const summary: CategoryApplySummary = { applied: 0, kept_human: 0, unverified: 0, cleared: 0, skipped: [] };

    for (const item of payload.items) {
      const crit = criteria.get(item.criterion_id);
      if (!crit || crit.deleted_at || crit.retired_at) {
        summary.skipped.push({ criterion_id: item.criterion_id, reason: "criterion_retired" });
        continue;
      }
      const snap = snapshot.get(item.criterion_id);
      const changed =
        !snap ||
        crit.category !== category ||
        (category === "financial"
          ? canonicalJson(rubricOf(crit.rubric_json)) !== canonicalJson(snap.rubric)
          : crit.label !== snap.label);
      if (changed) {
        summary.skipped.push({ criterion_id: item.criterion_id, reason: "criterion_changed" });
        continue;
      }
      const current = getEvalVerdict(db, version.brownfield_target_id, item.criterion_id);
      if (isHumanJudged(current)) {
        summary.kept_human++;
        continue;
      }
      const holdsAiVerdict = !!current && current.status !== "pending"; // non-human here (human was skipped above)
      if (item.proposed_status === null) {
        if (!holdsAiVerdict) {
          summary.unverified++;
          continue;
        }
      }
      const status = item.proposed_status ?? "pending";
      // The capability judgement's eval hash covers status+note+evidence_ref (ADR-0171). A re-apply of the SAME status by
      // a newer version must not move evidence_ref (it would invalidate a person's judgement for no substantive reason);
      // `source_version_id` already records the new version. A first write or a status change cites the version.
      const stableEvidence =
        holdsAiVerdict && current && current.status === status && current.evidence_ref ? current.evidence_ref : null;
      const res = writeEvalVerdict(db, {
        targetId: version.brownfield_target_id,
        criterionId: item.criterion_id,
        status,
        note: item.proposed_status === null ? (item.reason ?? item.note) : item.note,
        evidenceRef: stableEvidence ?? version.id,
        assessedBy: actor,
        source,
        sourceVersionId: version.id,
        now,
      });
      if (!res.ok) {
        // human_verdict_locked: a person's save won the race (the SQL guard). forbidden_status cannot occur here:
        // proposals are pass | partial | fail | null by the payload schema.
        summary.kept_human++;
        continue;
      }
      if (item.proposed_status === null) summary.cleared++;
      else summary.applied++;
    }

    if (summary.applied + summary.cleared > 0) invalidateTargetJudgements(db, version.brownfield_target_id, actor, now);
    appendAudit(db, {
      actor,
      action: "target_eval.ai_verdict.apply",
      target: `${target.opportunity_id}:${version.brownfield_target_id}:${category}:v${version.version_no}:run=${input.runId ?? version.run_id ?? "none"}:applied=${summary.applied}:kept_human=${summary.kept_human}:cleared=${summary.cleared}:skipped=${summary.skipped.length}`,
      now,
    });
    return summary;
  })();
}
