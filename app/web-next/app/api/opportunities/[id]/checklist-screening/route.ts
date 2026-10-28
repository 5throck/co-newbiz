// Gate checklist screening records (ADR-0187 phase P3, finding H9) - the
// person-recorded judgement of chk-legal-regulatory (Screening gate),
// chk-greenfield-feasibility and chk-site-selection (Pre-FS gate) that the S4 / S5
// completion predicates read (lib/checklist-gate-consumers.ts).
//   GET  : the three checklists - items, latest record, compliance-engine state, rollout mode.
//   POST : append a record { checklist, items:[{ id, result: pass|fail|not_applicable, note? }] }.
//          A person (the session user, analyst+) records it; an agent persona id is refused
//          (boundary #2). A not_applicable item needs a written reason. Append-only: a new
//          POST supersedes the previous record, history stays in process_run.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";
import {
  ChecklistRecordError,
  GATE_CHECKLISTS,
  checklistConsumerMode,
  checklistGateState,
  checklistItems,
  latestChecklistRecord,
  recordChecklistScreening,
} from "../../../../../lib/checklist-gate-consumers.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  return ok(
    {
      mode: checklistConsumerMode(),
      checklists: GATE_CHECKLISTS.map((c) => ({
        checklist: c.docId,
        gate: c.gate,
        stage: c.stage,
        items: checklistItems(c.docId).map((i) => ({ id: i.id, text: i.text, mandatory: i.mandatory })),
        record: latestChecklistRecord(db, id, c.docId),
        state: checklistGateState(db, id, c.docId),
      })),
    },
    200,
  );
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Recording a checklist screening requires the analyst role or higher." }); if (denied) return denied; }
  const { id } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  const body = (await request.json().catch(() => null)) as { checklist?: string; items?: Array<{ id: string; result: string; note?: string }> } | null;
  try {
    const rec = recordChecklistScreening(db, { opportunityId: id, docId: body?.checklist ?? "", items: body?.items ?? [], recordedBy: ctx.userId });
    appendAudit(db, { actor: ctx.userId, action: "checklist_screening.record", target: `${id}:${rec.docId}:${rec.id}`, now: rec.recordedAt });
    return ok({ record: rec, state: checklistGateState(db, id, rec.docId) }, 201);
  } catch (err) {
    if (err instanceof ChecklistRecordError) {
      return err.code === "agent_forbidden" ? forbidden(err.code, err.message) : badRequest("invalid_request", err.message);
    }
    throw err;
  }
});
