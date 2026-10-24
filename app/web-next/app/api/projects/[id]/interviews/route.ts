import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";
import { summarizeTriangulation, type InterviewSourceRow } from "../../../../../lib/interview-triangulation.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET/POST /api/projects/[id]/interviews — expert interviews / channel checks
// (commercial-dd-agent). evidence_ref mandatory (ADR-0058). B7.
// 2026-10-21: `claim` (migration 0159) names the key claim an interview is a
// source for; GET adds the cdd-07 triangulation summary (independent sources
// per claim) — the checklist verdict itself stays a human judgement.
export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const rows = getDb()
    .query("SELECT * FROM dd_interview WHERE project_id = ? ORDER BY created_at DESC")
    .all(id) as Array<InterviewSourceRow & Record<string, unknown>>;
  return ok({ interviews: rows, triangulation: summarizeTriangulation(rows) }, 200, { count: rows.length });
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "Recording interviews requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    interviewee?: string; topic?: string; response_summary?: string;
    disagreement?: string | null; follow_up?: string | null; evidence_ref?: string; claim?: string | null;
  } | null;
  if (!body?.interviewee?.trim() || !body?.topic?.trim() || !body?.response_summary?.trim()) {
    return badRequest("fields_required", "interviewee·topic·response_summary is required.");
  }
  if (!body.evidence_ref?.trim()) return badRequest("evidence_required", "evidence_ref is required (ADR-0058).");
  const claim = typeof body.claim === "string" ? body.claim.trim() || null : null;
  if (claim && claim.length > 300) return badRequest("invalid_request", "claim must be at most 300 characters.");
  const now = new Date().toISOString();
  const rid = ulid();
  getDb().run(
    `INSERT INTO dd_interview (id, project_id, interviewee, topic, response_summary, disagreement, follow_up, evidence_ref, claim, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rid, id, body.interviewee.trim(), body.topic.trim(), body.response_summary.trim(),
     body.disagreement?.trim() || null, body.follow_up?.trim() || null, body.evidence_ref.trim(), claim,
     auth.auth.userId, now, now],
  );
  appendAudit(getDb(), { actor: auth.auth.userId, action: "dd_interview.create", target: `${id}:${rid}`, now });
  return ok({ interview: { id: rid, claim } }, 201);
});
