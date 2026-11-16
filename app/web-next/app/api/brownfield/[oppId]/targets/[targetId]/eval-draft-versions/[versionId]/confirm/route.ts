// POST /api/brownfield/[oppId]/targets/[targetId]/eval-draft-versions/[versionId]/confirm — HUMAN-ONLY (ADR-0199 A6,
// boundary #2). A person bulk-confirms the proposals of the LATEST draft version of a candidate: pending criteria only,
// `확인 안됨` items skipped, an existing human verdict never overwritten, assessed_by = the caller. Cookie session of a
// non-agent account only; bearer / OAuth-delegated MCP / agent callers get 403 human_only (also in HUMAN_ONLY_ROUTES
// and the mcp-coverage exclusions). Body { criterion_ids?: string[] } (default: every proposed item). analyst+.
// 409 stale_version when the version is not the latest. Audit target_eval.confirm_from_version.
import { getDb } from "../../../../../../../../../../../db/client.ts";
import {
  authenticate,
  callPathOf,
  humanOnlyDenied,
  requireBusinessActor,
} from "../../../../../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../../../../../lib/envelope.ts";
import { promotedCarrierResponse } from "../../../../../../../../../lib/route-track-guard.ts";
import { confirmFromVersion } from "../../../../../../../../../lib/brownfield-eval-confirm.ts";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ oppId: string; targetId: string; versionId: string }> },
) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const humanDenied = humanOnlyDenied(
    ctx,
    "초안 제안의 확정은 사람만 할 수 있습니다 (boundary #2) — 에이전트는 초안만 만듭니다.",
  );
  if (humanDenied) return humanDenied;
  const denied = requireBusinessActor(ctx, "write", {
    viewerMessage: "Confirming a draft requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { oppId, targetId, versionId } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as { criterion_ids?: unknown };
  if (
    body.criterion_ids !== undefined &&
    (!Array.isArray(body.criterion_ids) || body.criterion_ids.some((x) => typeof x !== "string"))
  )
    return badRequest("invalid_request", "criterion_ids must be an array of strings.");
  const db = getDb();
  const promoted = promotedCarrierResponse(
    db,
    oppId,
    "이 기회는 이미 프로젝트로 승격되었습니다 — 초안 확정은 승격 전에만 할 수 있습니다.",
  );
  if (promoted) return promoted;
  const res = confirmFromVersion(db, {
    oppId,
    targetId,
    versionId,
    criterionIds: (body.criterion_ids as string[] | undefined) ?? null,
    actor: ctx.userId,
    via: callPathOf(ctx),
  });
  if (!res.ok)
    return res.status === 404
      ? notFound()
      : res.status === 409
        ? fail(409, res.code, res.message)
        : badRequest(res.code, res.message);
  return ok(
    {
      confirmed: res.confirmed,
      skipped: res.skipped,
      scores: res.scores,
      category: res.category,
      version_no: res.version_no,
    },
    200,
  );
}
