// GET/PUT /api/projects/[id]/capability-attainability — S8 view of the required-capability
// attainability judgement (ADR-0168; edit surface moved to S5/S7 by ADR-0171). GET stays and is the
// read-only summary of the SOURCE opportunity's S3 register rows (opportunity.capability_gap_json):
// the S3 definition plus the S5 judgement (resolution, expected_level, cost, months, grade, ...),
// with `edit_at` ("S5" Green Field, "S7" Brown Field) so the UI can link to the edit surface.
// PUT (and POST .../confirm) return 410 { code: "moved", editAt: "S5" | "S7" } for one
// release (OD-4); the writable routes are PUT/POST /api/opportunities/[id]/capability-attainability.
// Brown Field (ADR-0171 slice 2): the edit surface is the S7 per-target judgement
// (PUT/POST /api/brownfield/targets/{targetId}/capability-judgements). PUT returns 410 moved
// (editAt S7) here too, and GET is a read-only summary of the SELECTED target's S7 judgements.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { moved, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { buildAttainabilityView, editStageOf, readRegister, sourceOpportunityOf } from "../../../../../lib/capability-attainability.ts";
import { selectedTargetId } from "../../../../../lib/dd-target.ts";
import { buildTargetView, targetScope } from "../../../../../lib/brownfield-capability-judgement.ts";

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
  if (stage.editAt === "S7") {
    // Brown Field: S3 definitions plus the selected target's S7 judgement (read-only; edit at S7).
    const tid = selectedTargetId(id, db);
    const scope = tid ? targetScope(db, tid) : null;
    if (scope?.ok) {
      const v = buildTargetView(db, scope.target);
      return ok({ ...v, edit_at: "S7", track: stage.track, selected_target: { id: scope.target.id, company_name: scope.target.company_name }, edit_href: null }, 200); // 2026-10-20: the S7 per-target judgement surface is retired — S8 points at S9 (capability-dd)
    }
    // No (shortlisted) target selected yet: S3 definitions only, every judgement unjudged.
    const bare = reg.rows.map(({ attainability: _a, resolution: _r, ...r }) => ({ ...r, resolution: null }));
    return ok({ ...buildAttainabilityView(oppId, bare, null, []), edit_at: "S7", track: stage.track, selected_target: null, edit_href: null }, 200);
  }
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
  return moved("필요 역량 달성 가능성의 판정은 S7 대상별 점검으로 옮겨졌습니다 — S7에서 수정하세요 (PUT /api/brownfield/targets/{targetId}/capability-judgements).", "S7");
}
