import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET/POST /api/projects/[id]/interviews — expert interviews / channel checks
// (commercial-dd-agent). evidence_ref mandatory (ADR-0058). B7.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const rows = getDb()
    .query("SELECT * FROM dd_interview WHERE project_id = ? ORDER BY created_at DESC")
    .all(id);
  return ok({ interviews: rows }, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "인터뷰 기록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    interviewee?: string; topic?: string; response_summary?: string;
    disagreement?: string | null; follow_up?: string | null; evidence_ref?: string;
  } | null;
  if (!body?.interviewee?.trim() || !body?.topic?.trim() || !body?.response_summary?.trim()) {
    return badRequest("fields_required", "interviewee·topic·response_summary은 필수입니다.");
  }
  if (!body.evidence_ref?.trim()) return badRequest("evidence_required", "evidence_ref는 필수입니다 (ADR-0058).");
  const now = new Date().toISOString();
  const rid = ulid();
  getDb().run(
    `INSERT INTO dd_interview (id, project_id, interviewee, topic, response_summary, disagreement, follow_up, evidence_ref, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [rid, id, body.interviewee.trim(), body.topic.trim(), body.response_summary.trim(),
     body.disagreement?.trim() || null, body.follow_up?.trim() || null, body.evidence_ref.trim(),
     auth.auth.userId, now, now],
  );
  appendAudit(getDb(), { actor: auth.auth.userId, action: "dd_interview.create", target: `${id}:${rid}`, now });
  return ok({ interview: { id: rid } }, 201);
}
