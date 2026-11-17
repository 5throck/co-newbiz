// POST /api/brownfield/[oppId]/targets/[targetId]/eval-state/accept-rule — rule-only bulk accept (ADR-0200 Q1).
// Body { category: "financial" | "technical" }. Accepts every NON-PENDING `auto_rule` verdict of that category for this
// candidate as a `human` verdict (same status / note / evidence_ref / source_version_id, assessed_by = the person).
// `ai_draft` verdicts are never touched: they are reviewed one at a time. Human-only (boundary #2): an agent never
// records a human verdict. Each accepted item appends `target_eval.ai_verdict.review ... changed=0`, plus one summary
// audit `target_eval.rule_verdict.accept_all`. Content is unchanged, so no capability judgement is invalidated.
import { getDb } from "../../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../../db/lib/access-control.ts";
import { authenticate, humanOnlyDenied, requireBusinessActor } from "../../../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../../../lib/envelope.ts";
import { notSelectedResponse } from "../../../../../../../../lib/selected-guard.ts";
import { recordEvalVerdict } from "../../../../../../../../lib/brownfield-eval-criteria.ts";
import {
  EVAL_DRAFT_CATEGORIES,
  getEvalVerdict,
  type EvalVerdictRow,
} from "../../../../../../../../../../db/repositories/brownfield-eval-draft.repository.ts";

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Evaluation judgements require the analyst role or higher.",
  });
  if (denied) return denied;
  const humanDenied = humanOnlyDenied(
    auth.auth,
    "Accepting rule verdicts as human verdicts is a human-only act (boundary #2).",
  );
  if (humanDenied) return humanDenied;
  const { oppId, targetId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ?").get(targetId, oppId))
    return notFound();
  // N2 (owner decision 2026-11-17): S6/S7 target eval verdicts presuppose a selected opportunity.
  const selectionDenied = notSelectedResponse(db, oppId);
  if (selectionDenied) return selectionDenied;
  const body = (await request.json().catch(() => null)) as { category?: string } | null;
  const category = body?.category;
  if (!category || !(EVAL_DRAFT_CATEGORIES as readonly string[]).includes(category))
    return badRequest("invalid_request", `category must be one of: ${EVAL_DRAFT_CATEGORIES.join(" | ")}.`);

  const at = new Date().toISOString();
  const accepted: string[] = [];
  db.transaction(() => {
    const rows = (
      db
        .query(
          `SELECT s.criterion_id AS criterion_id
           FROM brownfield_target_eval_state s
           JOIN brownfield_eval_criterion c ON c.id = s.criterion_id
          WHERE s.brownfield_target_id = ? AND c.category = ? AND c.deleted_at IS NULL AND c.retired_at IS NULL
            AND s.verdict_source = 'auto_rule' AND s.status <> 'pending'
          ORDER BY s.criterion_id`,
        )
        .all(targetId, category) as Array<{ criterion_id: string }>
    )
      .map((r) => getEvalVerdict(db, targetId, r.criterion_id))
      .filter((r): r is EvalVerdictRow => r !== null);
    for (const r of rows) {
      const res = recordEvalVerdict(targetId, r.criterion_id, {
        status: r.status,
        note: r.note,
        evidence_ref: r.evidence_ref,
        assessedBy: auth.auth.userId,
        source: "human",
        sourceVersionId: r.source_version_id,
        expectSource: "auto_rule",
      });
      if (!res.ok) continue; // a verdict that became human since the read is left alone
      accepted.push(r.criterion_id);
      appendAudit(db, {
        actor: auth.auth.userId,
        action: "target_eval.ai_verdict.review",
        target: `${oppId}:${targetId}:${r.criterion_id}:from=auto_rule:version=${r.source_version_id ?? "none"}:changed=0`,
        now: at,
      });
    }
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "target_eval.rule_verdict.accept_all",
      target: `${oppId}:${targetId}:${category}:accepted=${accepted.length}`,
      now: at,
    });
  })();
  return ok({ target_id: targetId, category, accepted: accepted.length, criterion_ids: accepted }, 200);
}
