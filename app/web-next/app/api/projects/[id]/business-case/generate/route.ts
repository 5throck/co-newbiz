// POST /api/projects/[id]/business-case/generate — trigger the automatic
// 3-case generation (ADR-0098 §3). ASYNC (202 + poll): the route claims the project's run slot and
// answers 202 { runId, status: "running" } immediately; the chain runs detached from the request in
// the server process (lib/business-case-run.ts), so a browser refresh, a closed tab or a tunnel
// timeout cannot interrupt it. Per-activity state is written progressively by runActivityChain and
// read from GET .../generate (latest run) / GET .../generate/[runId]. A failure inside the run lands
// on the run (status "failed" + error), not on an HTTP error. Analyst+. Generation writes PROPOSALS
// only — never an adoption marker, never a gate_decision (boundary #2).
//
// GET /api/projects/[id]/business-case/generate — the project's latest generation run with its
// per-activity progress ({ run: null } when none): the page restores an in-flight run after a reload.
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { latestGenerationRun, startBusinessCaseGeneration } from "../../../../../../lib/business-case-run.ts";
import { fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  return ok({ project_id: id, run: latestGenerationRun(id) });
}

// Idempotency contract: a run already IN PROGRESS for this project answers 409 already_running
// (details.runId = that run) — even with `regenerate` — so a refresh-and-press-again can never start
// a duplicate chain. Otherwise, if a non-failed generation run exists, the EXISTING run is returned
// with 200 and alreadyRun: true instead of duplicating a 12-activity chain. A FAILED run does not
// block a retry. `{ regenerate: true }` bypasses the already-run guard and starts a NEW run — used by
// the per-target regenerate action (e.g. after ADR-0143 to produce per-target models); still analyst+ and
// proposals-only (boundary #2).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer")
    return forbidden("role_required", "Business-case auto-generation requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();

  let regenerate = false;
  try {
    const body = (await request.json()) as { regenerate?: unknown };
    regenerate = body?.regenerate === true;
  } catch {
    // empty body — ordinary generate path
  }

  const started = startBusinessCaseGeneration({ projectId: id, actor: ctx.userId, regenerate, source: "web" });
  switch (started.kind) {
    case "already_running":
      return fail(409, "already_running", "A business-case generation is already running for this project.", {
        runId: started.runId,
      });
    case "already_run":
      return ok({ runId: started.runId, alreadyRun: true }, 200);
    case "started":
      return ok({ runId: started.runId, status: "running", started_at: started.startedAt }, 202);
  }
}
