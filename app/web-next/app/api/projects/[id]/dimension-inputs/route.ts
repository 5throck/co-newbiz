// Port of app/server/pmi.ts GET/POST /api/projects/:id/dimension-inputs
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { assert as assertDimensionInput } from "../../../../../../../db/repositories/dimension-input.repository.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const url = new URL(request.url);
  const varKey = url.searchParams.get("var_key");
  const rows = varKey
    ? getDb()
        .query(
          "SELECT id, run_id, var_key, value_kind, value_text, value_num, unit, evidence_ref, asserted_by, reviewed_by, rationale, observed_at FROM dimension_input WHERE project_id = ? AND var_key = ? AND superseded_by IS NULL ORDER BY observed_at DESC",
        )
        .all(project.id, varKey)
    : getDb()
        .query(
          "SELECT id, run_id, var_key, value_kind, value_text, value_num, unit, evidence_ref, asserted_by, reviewed_by, rationale, observed_at FROM dimension_input WHERE project_id = ? AND superseded_by IS NULL ORDER BY observed_at DESC",
        )
        .all(project.id);
  return ok(rows, 200, { count: rows.length, reviewed: (rows as { reviewed_by: string | null }[]).filter((r) => r.reviewed_by !== null).length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Assertion writes require the analyst role.");
  const body = (await request.json().catch(() => null)) as {
    run_id?: string;
    var_key?: string;
    value?: { kind?: string; value?: unknown };
    evidence_ref?: string;
    rationale?: string;
    observed_at?: string;
  } | null;
  if (!body?.run_id || !body?.var_key?.trim() || !body?.value || !body?.evidence_ref?.trim() || !body?.rationale?.trim()) {
    return badRequest("invalid_request", "run_id, var_key, value {kind,value}, evidence_ref and rationale are required.");
  }
  const kind = body.value.kind;
  if (kind !== "num" && kind !== "text" && kind !== "bool") {
    return badRequest("invalid_value_kind", "value.kind must be num, text or bool.");
  }
  try {
    const row = assertDimensionInput(
      {
        project_id: project.id,
        run_id: body.run_id,
        var_key: body.var_key.trim(),
        value: { kind, value: body.value.value } as never,
        evidence_ref: body.evidence_ref.trim(),
        asserted_by: ctx.userId,
        rationale: body.rationale.trim(),
        observed_at: body.observed_at,
      },
      getDb(),
    );
    appendAudit(getDb(), { actor: ctx.userId, action: "dimension_input_assert", target: `${project.id}:${row.id}`, now: new Date().toISOString() });
    return ok({ id: row.id, var_key: row.var_key, reviewed: false }, 201);
  } catch (err) {
    return badRequest("assertion_failed", err instanceof Error ? err.message : "Assertion rejected.");
  }
}
