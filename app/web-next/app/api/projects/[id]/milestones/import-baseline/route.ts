// POST /api/projects/[id]/milestones/import-baseline — one-click import of the
// confirmed greenfield execution baseline's permit/certification milestones
// (2026-10-21, migration 0167). Idempotent: rows whose title already exists in
// this project's execution_baseline source are skipped. Analyst+, audited
// through the create path; members only (FR-SEC-01).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { importBaselineMilestones } from "../../../../../../lib/milestones.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "기준선 가져오기는 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  try {
    const result = importBaselineMilestones(getDb(), id, auth.auth.userId);
    return ok(result, 200);
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : "가져오기에 실패했습니다.");
  }
});
