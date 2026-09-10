// GET/PUT /api/projects/[id]/establishment — S11 설립 실행 5단계, project-keyed
// projection (ADR-0100 §2). Mirrors the opportunity establishment route's
// semantics (role checks, sequence enforcement, audit) but resolves rows
// through project_id (0070), falling back to the source_opportunity_id
// backlink only for rows that predate the backfill. Deny-by-default:
// getProjectIfVisible via visibleProject — non-members get 404 (FR-SEC-01);
// admins are excluded by role separation. PUT is analyst+ (viewer 403).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import {
  ESTABLISHMENT_ORIGINS,
  ESTABLISHMENT_STATUSES,
  listEstablishmentSteps,
  establishmentProgress,
  upsertEstablishmentStep,
} from "../../../../../lib/establishment.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  // visibleProject's row carries only id/project_no — origin comes straight
  // from md_project (0063 column, origin∈{internal,joint} applies per ADR-0047).
  const origin = (getDb().query("SELECT origin FROM md_project WHERE id = ?").get(id) as { origin: string | null })
    ?.origin ?? null;
  const steps = listEstablishmentSteps(id);
  const progress = establishmentProgress(id);
  return ok(
    {
      project: { id: project.id, project_no: project.project_no, origin },
      steps,
      complete: progress.complete,
      progress: `${progress.done}/5`,
    },
    200,
    { count: steps.length },
  );
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "설립 실행 기록 갱신은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    step_no?: number; status?: string; origin?: string;
    checklist_item?: string; evidence_url?: string; note?: string;
  } | null;
  const stepNo = Number(body?.step_no);
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 5) return badRequest("invalid_request", "step_no는 1–5 사이 정수입니다.");
  const status = body?.status;
  if (!status || !ESTABLISHMENT_STATUSES.includes(status as (typeof ESTABLISHMENT_STATUSES)[number])) {
    return badRequest("invalid_request", `status는 ${ESTABLISHMENT_STATUSES.join(" | ")} 중 하나입니다.`);
  }
  const origin = body?.origin;
  if (!origin || !ESTABLISHMENT_ORIGINS.includes(origin as (typeof ESTABLISHMENT_ORIGINS)[number])) {
    return badRequest("invalid_request", "origin은 internal | joint 중 하나입니다 (ADR-0047).");
  }

  const result = upsertEstablishmentStep(
    id,
    {
      step_no: stepNo,
      status: status as (typeof ESTABLISHMENT_STATUSES)[number],
      origin: origin as (typeof ESTABLISHMENT_ORIGINS)[number],
      checklist_item: body?.checklist_item ?? null,
      evidence_url: body?.evidence_url ?? null,
      note: body?.note ?? null,
    },
    ctx.userId,
  );
  if (!result.ok) {
    if (result.error === "sequence_violation") {
      return badRequest("invalid_request", "완료확인(5단계)은 선행 4단계가 모두 완료된 후에만 완료할 수 있습니다.");
    }
    return badRequest("invalid_request", "이 프로젝트에는 설립 실행 기록의 근원 기회(origin opportunity) 연결이 없어 새 단계를 생성할 수 없습니다.");
  }
  appendAudit(getDb(), { actor: ctx.userId, action: "entity_establishment.update", target: id, now: result.updated_at });

  const steps = listEstablishmentSteps(id);
  const progress = establishmentProgress(id);
  return ok(
    {
      id: result.id, step_no: result.step_no, status: result.status, title: result.title,
      step_done: result.step_done, updated_at: result.updated_at,
      complete: progress.complete, progress: `${progress.done}/5`,
    },
    200,
  );
}
