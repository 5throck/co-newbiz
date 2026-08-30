// DD workspace — checklist-driven Commercial/Technical/Legal DD. GET merges
// the gate-checklist item definitions (parsed from checklists/*.yaml, the
// same SSOT the /library view reads) with this project's recorded item
// states (project_checklist_item_state, migration 0039) plus progress
// rollups. POST records one item assessment (analyst+; viewer refused,
// audited). 'waived' requires a waiver_id belonging to this project —
// checked here, not by FK, because waiver rows are project-scoped keys.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { DD_WORKSPACE_CHECKLISTS, getChecklistItems } from "../../../../../../lib/library.ts";

const STATES = new Set(["pending", "pass", "fail", "na", "waived"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id, kind } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const checklistId = DD_WORKSPACE_CHECKLISTS[kind];
  if (!checklistId) return notFound();
  const items = getChecklistItems(checklistId);
  if (items === null) return notFound();

  const db = getDb();
  const states = db
    .query(
      `SELECT item_id, status, note, evidence_ref, waiver_id, assessed_by, assessed_at
       FROM project_checklist_item_state
       WHERE project_id = ? AND checklist_id = ?`,
    )
    .all(project.id, checklistId) as Array<{
    item_id: string; status: string; note: string | null; evidence_ref: string | null;
    waiver_id: string | null; assessed_by: string; assessed_at: string;
  }>;
  const byItem = new Map(states.map((s) => [s.item_id, s]));

  const merged = items.map((item) => {
    const state = byItem.get(item.id);
    return {
      ...item,
      status: state?.status ?? "pending",
      note: state?.note ?? null,
      evidence_ref: state?.evidence_ref ?? null,
      waiver_id: state?.waiver_id ?? null,
      assessed_by: state?.assessed_by ?? null,
      assessed_at: state?.assessed_at ?? null,
    };
  });

  const assessed = merged.filter((m) => m.status !== "pending");
  const mandatoryOpen = merged.filter((m) => m.mandatory && !["pass", "na", "waived"].includes(m.status));
  return ok(
    {
      checklist_id: checklistId,
      kind,
      items: merged,
      progress: {
        total: merged.length,
        assessed: assessed.length,
        pass: merged.filter((m) => m.status === "pass").length,
        fail: merged.filter((m) => m.status === "fail").length,
        na: merged.filter((m) => m.status === "na").length,
        waived: merged.filter((m) => m.status === "waived").length,
        mandatory_total: merged.filter((m) => m.mandatory).length,
        mandatory_open: mandatoryOpen.map((m) => ({ id: m.id, text: m.text, status: m.status })),
      },
    },
    200,
    { count: merged.length },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id, kind } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  const checklistId = DD_WORKSPACE_CHECKLISTS[kind];
  if (!checklistId) return notFound();
  if (ctx.role === "viewer") {
    return forbidden("role_required", "DD checklist assessments are recorded by analysts.");
  }

  const body = (await request.json().catch(() => null)) as {
    item_id?: string; status?: string; note?: string; evidence_ref?: string; waiver_id?: string;
  } | null;
  if (!body?.item_id || !body.status || !STATES.has(body.status)) {
    return badRequest("invalid_request", "item_id and status (pending|pass|fail|na|waived) are required.");
  }
  const item = getChecklistItems(checklistId)?.find((i) => i.id === body.item_id);
  if (!item) return badRequest("unknown_item", `No checklist item ${body.item_id} in ${checklistId}.`);
  if (body.status === "waived" && !item.waiver_eligible) {
    return badRequest("not_waiver_eligible", `Checklist item ${item.id} is not waiver-eligible.`);
  }

  const db = getDb();
  const now = new Date().toISOString();
  if (body.status === "waived") {
    if (!body.waiver_id) return badRequest("waiver_required", "status='waived' requires a waiver_id.");
    const waiver = db
      .query("SELECT id FROM waiver WHERE id = ? AND project_id = ?")
      .get(body.waiver_id, project.id);
    if (!waiver) return badRequest("unknown_waiver", "waiver_id does not reference a waiver of this project.");
  }

  const existing = db
    .query("SELECT id FROM project_checklist_item_state WHERE project_id = ? AND checklist_id = ? AND item_id = ?")
    .get(project.id, checklistId, body.item_id) as { id: string } | null;

  if (existing) {
    db.run(
      `UPDATE project_checklist_item_state
       SET status = ?, note = ?, evidence_ref = ?, waiver_id = ?, assessed_by = ?, assessed_at = ?
       WHERE id = ?`,
      [body.status, body.note ?? null, body.evidence_ref ?? null, body.waiver_id ?? null, ctx.userId, now, existing.id],
    );
  } else {
    db.run(
      `INSERT INTO project_checklist_item_state
         (id, project_id, checklist_id, item_id, status, note, evidence_ref, waiver_id, assessed_by, assessed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), project.id, checklistId, body.item_id, body.status, body.note ?? null,
        body.evidence_ref ?? null, body.waiver_id ?? null, ctx.userId, now],
    );
  }
  appendAudit(db, {
    actor: ctx.userId,
    action: "dd_checklist_assess",
    target: `${project.project_no}:${checklistId}:${body.item_id}=${body.status}`,
    now,
  });
  return ok({ item_id: body.item_id, status: body.status, assessed_by: ctx.userId, assessed_at: now }, existing ? 200 : 201);
}
