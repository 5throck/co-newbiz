// PMI kickoff record (S11, brownfield M&A / JV / strategic investment) —
// Wave F-6. GET reads the latest record; POST appends a HUMAN-recorded
// kickoff (recorded_by = the session user, analyst+; agents have no accounts
// and cannot call this — boundary #1/#2). Append-only: a new POST supersedes
// the previous record, history stays in process_run.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { latestPmiKickoff, PmiKickoffError, pmiApplicability, recordPmiKickoff } from "../../../../../../lib/pmi-kickoff.ts";

// ONE shared resolver (ADR-0161 review F6) — same as the other PMI writes.
function applicability(projectId: string): { track: string | null; subTrack: string | null; applies: boolean } {
  return pmiApplicability(getDb(), projectId);
}

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  return ok({ ...applicability(id), record: latestPmiKickoff(getDb(), id) }, 200);
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "PMI 킥오프 기록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const a = applicability(id);
  if (!a.applies) {
    // ADR-0161: greenfield and non-PMI sub-tracks are refused like the other PMI writes.
    return forbidden("not_applicable_track", "PMI 킥오프는 Brownfield M&A·JV·전략적 투자 Route에만 적용됩니다.");
  }
  const body = (await request.json().catch(() => null)) as { owner?: string; plan_note?: string } | null;
  const db = getDb();
  try {
    const rec = recordPmiKickoff(db, {
      projectId: id,
      owner: body?.owner ?? "",
      planNote: body?.plan_note ?? "",
      recordedBy: ctx.userId,
    });
    appendAudit(db, { actor: ctx.userId, action: "pmi_kickoff.record", target: `${id}:${rec.id}`, now: rec.recordedAt });
    return ok(rec, 201);
  } catch (err) {
    if (err instanceof PmiKickoffError) {
      return err.code === "agent_forbidden" ? forbidden(err.code, err.message) : badRequest("invalid_request", err.message);
    }
    throw err;
  }
});
