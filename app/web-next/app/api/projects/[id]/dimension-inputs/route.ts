// Judged-variable assertions of a project (dimension_input; repository db/repositories/dimension-input.repository.ts).
// GET lists the assertions (`?var_key=` narrows) with the assertable-variable vocabulary. POST records one assertion; it
// lands UNREVIEWED by design - only the live AND reviewed row feeds the snapshot filler, and the review is a separate,
// human-only act by a DIFFERENT person (POST .../dimension-inputs/{rowId}/review). asserted_by is ALWAYS the session user.
// effective_on (ADR-0194 item B): required for infra.plan_finalized = 'yes' (the finalized plan document's date, with a
// citation evidence_ref), refused on 'no', never defaulted from observed_at or any recording/gate time (risk-officer B-2).
// An agent may record only a value (and date) the calling user stated or read verbatim from the cited document.
// Membership: a non-member (or an MNPI project without insider status) gets 404, not 403 (FR-SEC-03).
import { getDb } from "../../../../../../../db/client.ts";
import {
  assert, listAssertableVars, listProjectAssertions,
} from "../../../../../../../db/repositories/dimension-input.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true })) return notFound();
  const db = getDb();
  const varKey = new URL(request.url).searchParams.get("var_key")?.trim() || undefined;
  const inputs = listProjectAssertions(db, id, varKey);
  return ok(
    {
      project_id: id,
      inputs,
      live: inputs.filter((r) => r.superseded_by === null),
      vocabulary: { assertable_vars: listAssertableVars(db) },
    },
    200,
    { count: inputs.length },
  );
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Recording an assertion requires the analyst role or higher." }); if (denied) return denied; }
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("invalid_request", "A JSON body {var_key, value, evidence_ref, rationale, effective_on?, observed_at?, run_id?} is required.");
  }
  const db = getDb();
  const varKey = typeof body.var_key === "string" ? body.var_key.trim() : "";
  const def = listAssertableVars(db).find((v) => v.var_key === varKey);
  if (!def) return badRequest("invalid_request", `var_key must be one of the assertable variables: ${listAssertableVars(db).map((v) => v.var_key).join(" | ")}.`);
  // The registry's value_type fixes the value kind (the repository re-checks coherence).
  let value: { kind: "num"; value: number } | { kind: "text"; value: string } | { kind: "bool"; value: boolean };
  if (def.value_type === "number") {
    if (typeof body.value !== "number") return badRequest("invalid_request", `${varKey} takes a number value.`);
    value = { kind: "num", value: body.value };
  } else if (def.value_type === "boolean") {
    if (typeof body.value !== "boolean") return badRequest("invalid_request", `${varKey} takes a boolean value.`);
    value = { kind: "bool", value: body.value };
  } else {
    if (typeof body.value !== "string") return badRequest("invalid_request", `${varKey} takes a string value.`);
    value = { kind: "text", value: body.value };
  }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  if (body.effective_on !== undefined && body.effective_on !== null && typeof body.effective_on !== "string") return badRequest("invalid_request", "effective_on must be a YYYY-MM-DD string.");
  // Run scope: the explicit run_id (repository checks it belongs to the project) or the project's latest live run.
  const runId = str(body.run_id)?.trim() || (db.query("SELECT id FROM run WHERE project_id = ? AND superseded_by IS NULL ORDER BY created_at DESC, id DESC LIMIT 1").get(id) as { id: string } | null)?.id;
  if (!runId) return fail(409, "no_run", "This project has no analysis run - assertions are recorded run-scoped (ADR-0005).");
  try {
    // Any asserted_by / reviewed_by field in the body is ignored: the assertion belongs to the calling session user.
    const row = assert(
      {
        project_id: id, run_id: runId, var_key: varKey, value, evidence_ref: str(body.evidence_ref) ?? "", asserted_by: ctx.userId,
        rationale: str(body.rationale) ?? "", observed_at: str(body.observed_at), effective_on: (body.effective_on as string | null | undefined) ?? undefined,
      },
      db,
    );
    return ok(row, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Not an active member / not an MNPI insider: indistinguishable from a missing project (404-not-403).
    if (/not an active project_member|MNPI project/.test(message)) return notFound();
    if (message.startsWith("dimension_input_write_rejected:")) return badRequest("invalid_request", message.replace("dimension_input_write_rejected: ", ""));
    throw e;
  }
});
