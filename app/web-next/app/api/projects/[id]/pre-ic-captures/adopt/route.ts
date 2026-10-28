// POST /api/projects/[id]/pre-ic-captures/adopt — S11 adoption of pre-IC
// captures (ADR-0187 D4). Appends a baseline entry for every capture the
// latest execution baseline does not yet reference, linked by id (no
// re-entry), as a new UNCONFIRMED entries record — re-confirmation by the
// project lead is still required. Body: {permit_target_dates?: {<permit id>:
// "YYYY-MM-DD"}}; a permit without a target date is skipped, never dated by
// default. HUMAN-ONLY like the execution-baseline route it writes through
// (cookie session, not bearer / OAuth-delegated / agent), analyst+,
// need-to-know (visibleProject + MNPI insider), audited
// (execution_baseline.entries_recorded + execution_baseline.pre_ic_adopted).
import { getDb } from "../../../../../../../../db/client.ts";
import { requireInsiderIfMnpi } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { AGENT_KEYS } from "../../../../../../lib/agent-registry.generated.ts";
import { currentPrincipal } from "../../../../../../lib/mcp/principal-context.ts";
import { adoptPreIcCaptures, captureFailure } from "../../../../../../lib/pre-ic-capture.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "Only a human can adopt captures into the execution baseline (boundary #2) — agents may only draft.");
  }
  const denied = requireBusinessActor(ctx, "write");
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  try {
    requireInsiderIfMnpi(db, id, ctx.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown> | null;
  const r = adoptPreIcCaptures({ projectId: id, permitTargetDates: body?.permit_target_dates, actor: ctx.userId }, db);
  if (!r.ok) return captureFailure(r);
  return ok({ record: r.record, adopted: r.adopted, skipped: r.skipped }, 200);
}
