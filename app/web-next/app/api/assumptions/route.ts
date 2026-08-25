// Port of app/server/analysis.ts GET/POST /api/assumptions
import { getDb } from "../../../../../db/client.ts";
import { AssumptionValidationError, recordAssumption } from "../../../../../db/lib/assumption.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../lib/envelope.ts";
import { visibleProject } from "../../../lib/project-visibility.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const url = new URL(request.url);
  const runId = url.searchParams.get("run_id") || null;
  const key = url.searchParams.get("key") || null;
  if (runId) {
    const run = getDb().query("SELECT project_id FROM run WHERE id = ?").get(runId) as { project_id: string } | null;
    if (!run || !visibleProject(ctx, run.project_id)) return notFound();
  }
  const rows = getDb()
    .query(
      `SELECT id, run_id, assumption_key, kind, value, rationale, anchor_ref, as_of, ttl_days
       FROM assumption
       WHERE (? IS NULL OR run_id = ?) AND (? IS NULL OR assumption_key = ?)
       ORDER BY as_of DESC, id DESC LIMIT 200`,
    )
    .all(runId, runId, key, key);
  return ok(rows, 200, { count: rows.length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const body = (await request.json().catch(() => null)) as
    | {
      run_id?: string;
      assumption_key?: string;
      kind?: string;
      value?: number;
      as_of?: string;
      rationale?: string;
      anchor_ref?: string;
      ttl_days?: number;
    }
    | null;
  if (!body?.run_id?.trim() || !body?.assumption_key?.trim()) {
    return badRequest("invalid_request", "run_id and assumption_key are required.");
  }
  const run = getDb().query("SELECT project_id FROM run WHERE id = ?").get(body.run_id.trim()) as { project_id: string } | null;
  if (!run || !visibleProject(ctx, run.project_id)) return notFound();
  if (ctx.role === "viewer") {
    return forbidden("role_required", "Assumption writes require the analyst role.");
  }
  try {
    const row = recordAssumption(getDb(), {
      runId: body.run_id.trim(),
      assumptionKey: body.assumption_key.trim(),
      kind: body.kind ?? "",
      value: body.value,
      asOf: body.as_of ?? "",
      rationale: body.rationale,
      anchorRef: body.anchor_ref,
      ttlDays: Number.isInteger(body.ttl_days) ? body.ttl_days : null,
      actor: ctx.userId,
      now: new Date().toISOString(),
    });
    return ok({ id: row.id }, 201);
  } catch (err) {
    if (err instanceof AssumptionValidationError) {
      return badRequest(err.code, err.message);
    }
    return badRequest("assumption_rejected", err instanceof Error ? err.message : "Assumption write failed.");
  }
}
