// Greenfield S11 execution baseline (ADR-0161 Row 2, procedure
// greenfield-execution-baseline). GET — read-only status: applicability
// (track + case_type, fail-closed needs_classification), capex_tranche
// reconciliation vs the S8 adopted case (exact match; differences are
// findings), S10 structure presence, source permits / certifications /
// incentives, ADR-0159 goals (reference only), the latest baseline record and
// the retroactive requirement. POST — HUMAN-ONLY (boundary #2): cookie
// session + CSRF (authenticate()), analyst+, project visibility, MNPI insider
// check; bearer / OAuth-delegated / agent callers get 403 human_only and the
// in-process MCP port refuses the route via HUMAN_ONLY_ROUTES.
// Actions: record_entries {entries} | confirm {rationale}. The baseline never
// writes capex_tranche; release stays the two-person capex-tranches route.
import { getDb } from "../../../../../../../db/client.ts";
import { requireInsiderIfMnpi } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { NextResponse } from "next/server";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { AGENT_KEYS } from "../../../../../lib/agent-registry.generated.ts";
import { currentPrincipal } from "../../../../../lib/mcp/principal-context.ts";
import {
  confirmExecutionBaseline,
  executionBaselineStatus,
  recordBaselineEntries,
  type BaselineResult,
} from "../../../../../lib/greenfield-execution.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true })) return notFound();
  try {
    requireInsiderIfMnpi(getDb(), id, auth.auth.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  return ok(executionBaselineStatus(id), 200);
}

function failure(r: Extract<BaselineResult<object>, { ok: false }>) {
  if (r.code === "invalid_request") return badRequest("invalid_request", r.message);
  if (r.code === "agent_forbidden" || r.code === "not_applicable_track" || r.code === "insider_required" || r.code === "lead_required") return forbidden(r.code, r.message);
  if (r.code === "findings_open" || r.code === "baseline_empty") {
    // 409 with the open findings / missing sections the confirmer must address.
    return NextResponse.json(
      {
        data: null,
        meta: { as_of: new Date().toISOString(), open_findings: r.open_findings ?? [], missing_sections: r.missing_sections ?? [] },
        error: { code: r.code, message: r.message },
      },
      { status: 409 },
    );
  }
  return fail(409, r.code, r.message);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "실행 기준선 기록과 확인은 사람만 할 수 있습니다 (boundary #2) — 에이전트는 초안만 제안합니다.");
  }
  if (ctx.role === "viewer") return forbidden("role_required", "analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  try {
    requireInsiderIfMnpi(getDb(), id, ctx.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.action === "record_entries") {
    const r = recordBaselineEntries({ projectId: id, entries: body.entries, actor: ctx.userId });
    return r.ok ? ok({ record: r.record }, 201) : failure(r);
  }
  if (body?.action === "confirm") {
    const r = confirmExecutionBaseline({ projectId: id, rationale: body.rationale, acknowledgedFindings: body.acknowledged_findings, actor: ctx.userId });
    return r.ok ? ok({ record: r.record, open_findings: r.open_findings }, 201) : failure(r);
  }
  return badRequest("invalid_request", "action은 record_entries | confirm 중 하나입니다.");
}
