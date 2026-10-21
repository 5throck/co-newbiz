// POST /api/projects/[id]/milestones/import-baseline — one-click import of the
// confirmed greenfield execution baseline's permit/certification milestones
// (2026-10-21, migration 0167). Idempotent: rows whose title already exists in
// this project's execution_baseline source are skipped. Analyst+, audited
// through the create path; members only (FR-SEC-01).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../../lib/envelope.ts";
import { importBaselineMilestones } from "../../../../../../lib/milestones.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { resolveTrack } from "../../../../../../lib/project-track.ts";
import { route } from "../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "기준선 가져오기는 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  // T-20261022-016: the import source is the greenfield execution baseline, so the
  // carrier must still resolve greenfield. latestConfirmedBaseline alone cannot see
  // a re-classification — a project moved to brownfield (or unresolvable) keeps its
  // historical baseline but must not import from it (same guard shape as the S5 route).
  if (resolveTrack(id, getDb()).track !== "greenfield") {
    return fail(409, "not_applicable_track", "실행 기준선 가져오기는 greenfield 프로젝트에만 적용됩니다 — 현재 트랙이 brownfield이거나 확인되지 않았습니다.");
  }
  try {
    const result = importBaselineMilestones(getDb(), id, auth.auth.userId);
    return ok(result, 200);
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : "가져오기에 실패했습니다.");
  }
});
