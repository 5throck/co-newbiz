// GET/PUT /api/projects/[id]/establishment — S11 설립 실행 5단계, project-keyed
// projection (ADR-0100 §2). Mirrors the opportunity establishment route's
// semantics (role checks, sequence enforcement, audit) but resolves rows
// through project_id (0070), falling back to the source_opportunity_id
// backlink only for rows that predate the backfill. Deny-by-default:
// getProjectIfVisible via visibleProject — non-members get 404 (FR-SEC-01);
// admins are excluded by role separation. PUT is analyst+ (viewer 403).
// ADR-0165: PUT is a status change (in_progress | done | halted | escalated;
// done needs evidence, a done row needs POST .../reopen first); assignee and
// reopen live on sibling routes. `done` via an agent is refused by the
// in-process guard (HUMAN_ONLY_ROUTES bodyField) AND by this route itself:
// status=done from a bearer token / agent account is 403 human_only.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, callPathOf, humanOnlyDenied } from "../../../../../lib/auth.ts";
import {
  ESTABLISHMENT_ORIGINS,
  ESTABLISHMENT_MODES,
  ESTABLISHMENT_STEP_COUNT,
  getEstablishmentModeState,
  listEstablishmentHistory,
  listEstablishmentSteps,
  establishmentProgress,
  stepTitles,
  changeEstablishmentStatus,
  listEstablishmentEvents,
  listEstablishmentMembers,
  reopenedAfterGate,
} from "../../../../../lib/establishment.ts";
import { establishmentErrorResponse } from "../../../../../lib/establishment-http.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

const CHANGEABLE = ["in_progress", "done", "halted", "escalated"] as const;

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
  const modeState = getEstablishmentModeState(id);
  const mode = progress.mode;
  return ok(
    {
      project: { id: project.id, project_no: project.project_no, origin },
      // ADR-0167: the active mode drives the step set. mode null = a Green Field
      // project that has not chosen yet (steps is empty; writes fail mode_not_chosen).
      mode,
      mode_label: modeState?.mode_label ?? null,
      mode_suggested: modeState?.suggested ?? null,
      allowed_modes: modeState?.allowed_modes ?? [],
      mode_changed_after_gate: modeState?.changed_after_gate ?? false,
      step_titles: mode ? stepTitles(mode) : null,
      all_step_titles: Object.fromEntries(ESTABLISHMENT_MODES.map((m) => [m, stepTitles(m)])),
      steps,
      history_steps: listEstablishmentHistory(id),
      members: listEstablishmentMembers(id),
      history: listEstablishmentEvents(id, 20),
      ...reopenedAfterGate(id),
      complete: progress.complete,
      progress: `${progress.done}/${ESTABLISHMENT_STEP_COUNT}`,
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
    checklist_item?: string; evidence_url?: string; note?: string; assignee_user_id?: string | null;
    /** ADR-0167 — optional statement of the active mode; it can never SET it (409 mode_mismatch). */
    mode?: string;
  } | null;
  // Completing a step is a human act (boundary #2). Enforced here, not only at
  // the MCP in-process port: a bearer token reaches this route directly.
  if (body?.status === "done") {
    const denied = humanOnlyDenied(ctx, "설립 실행 단계 완료 처리는 사람만 할 수 있습니다 (boundary #2) — 에이전트는 진행 중·중단·에스컬레이션만 기록합니다.");
    if (denied) return denied;
  }
  const stepNo = Number(body?.step_no);
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 5) return badRequest("invalid_request", "step_no는 1–5 사이 정수입니다.");
  const status = body?.status;
  if (!status || !CHANGEABLE.includes(status as (typeof CHANGEABLE)[number])) {
    return badRequest("invalid_request", `status는 ${CHANGEABLE.join(" | ")} 중 하나입니다.`);
  }
  const origin = body?.origin;
  if (!origin || !ESTABLISHMENT_ORIGINS.includes(origin as (typeof ESTABLISHMENT_ORIGINS)[number])) {
    return badRequest("invalid_request", "origin은 internal | joint 중 하나입니다 (ADR-0047).");
  }
  for (const f of ["evidence_url", "note", "checklist_item"] as const) {
    if (body?.[f] != null && typeof body[f] !== "string") return badRequest("invalid_request", `${f}는 문자열이어야 합니다.`);
  }
  if ((body?.note?.length ?? 0) > 2000) return badRequest("invalid_request", "note는 2000자 이하입니다.");
  if (body?.mode != null && !(ESTABLISHMENT_MODES as readonly string[]).includes(body.mode)) {
    return badRequest("invalid_request", `mode는 ${ESTABLISHMENT_MODES.join(" | ")} 중 하나입니다 (ADR-0167).`);
  }
  const hasAssignee = !!body && Object.prototype.hasOwnProperty.call(body, "assignee_user_id");
  if (hasAssignee && body?.assignee_user_id != null && typeof body.assignee_user_id !== "string") {
    return badRequest("invalid_request", "assignee_user_id는 문자열 또는 null입니다.");
  }

  const result = changeEstablishmentStatus(
    id,
    {
      step_no: stepNo,
      status: status as (typeof CHANGEABLE)[number],
      origin: origin as (typeof ESTABLISHMENT_ORIGINS)[number],
      checklist_item: body?.checklist_item ?? null,
      evidence_url: body?.evidence_url ?? null,
      note: body?.note ?? null,
      mode: (body?.mode as (typeof ESTABLISHMENT_MODES)[number] | undefined) ?? null,
      ...(hasAssignee ? { assignee_user_id: body?.assignee_user_id ?? null } : {}),
    },
    ctx.userId,
    callPathOf(ctx),
  );
  if (!result.ok) return establishmentErrorResponse(result.error);

  const progress = establishmentProgress(id);
  return ok(
    {
      id: result.id, step_no: result.step_no, status: result.status, title: result.title,
      step_done: result.step_done, assignee_user_id: result.assignee_user_id, updated_at: result.updated_at,
      complete: progress.complete, progress: `${progress.done}/5`,
    },
    200,
  );
}
