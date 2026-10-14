// GET/PUT /api/projects/[id]/capability-attainability — S8 view of the required-capability
// attainability judgement (ADR-0168; edit surface moved to S5/S7 by ADR-0171). GET stays and is the
// read-only summary of the SOURCE opportunity's S3 register rows (opportunity.capability_gap_json):
// the S3 definition plus the S5 judgement (resolution, expected_level, cost, months, grade, ...),
// with `edit_at` ("S5" Green Field, "S7" Brown Field) so the UI can link to the edit surface.
// PUT (and POST .../confirm) return 410 { code: "moved", editAt: "S5" } for Green Field for one
// release (OD-4); the writable routes are PUT/POST /api/opportunities/[id]/capability-attainability.
// Brown Field keeps this legacy write path (same body and guards) only until the S7 per-target
// surface ships (slice 2b).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, moved, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { buildAttainabilityView, editStageOf, readRegister, saveAttainability, sourceOpportunityOf } from "../../../../../lib/capability-attainability.ts";

function load(projectId: string) {
  const db = getDb();
  const oppId = sourceOpportunityOf(db, projectId);
  const reg = oppId ? readRegister(db, oppId) : null;
  return { db, oppId, reg };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const { db, oppId, reg } = load(id);
  const stage = editStageOf(db, id);
  if (!oppId || !reg) return ok({ ...buildAttainabilityView(null, [], null), edit_at: stage.editAt, track: stage.track }, 200);
  return ok({ ...buildAttainabilityView(oppId, reg.rows, reg.json === null ? null : reg.updatedAt ?? "", reg.removed), edit_at: stage.editAt, track: stage.track }, 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "필요 역량 달성 가능성 저장은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  if (editStageOf(getDb(), id).editAt === "S5") return moved("필요 역량 달성 가능성의 판정은 S5로 옮겨졌습니다 — S5에서 수정하세요 (PUT /api/opportunities/{id}/capability-attainability).", "S5");
  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  if (!body) return badRequest("invalid_request", "요청 본문이 올바르지 않습니다.");
  const { db, oppId, reg } = load(id);
  if (!oppId || !reg) return badRequest("no_source_opportunity", "원 기회(S3 역량 레지스터)가 없는 프로젝트입니다.");
  const at = new Date().toISOString();
  // Read-merge-write in one transaction: only S8-owned fields are merged onto the live register.
  const res = saveAttainability(db, oppId, body.rows, { userId: ctx.userId, human: humanOnlyDenied(ctx, "") === null }, { action: "capability_attainability.save", target: `${id}#capability@${callPathOf(ctx)}`, at });
  if (!res.ok) return badRequest(res.error.code, res.error.message);
  if (res.changedIds.length === 0) return ok({ ...buildAttainabilityView(oppId, res.rows, res.updatedAt, res.removed), changed: 0 }, 200);
  return ok({ ...buildAttainabilityView(oppId, res.rows, at, res.removed), changed: res.changedIds.length }, 200);
}
