// Agent stage execution — run the orchestrator for a stage. The run and all
// agent positions/conclusions are persisted (process_run / agent_position),
// and the stage's primary gate receives an agent-made evaluation record
// (recommendation). Human override happens through gate-decisions.
import { getDb } from "../../../../../../../db/client.ts";
import { runStageAgents } from "../../../../../lib/agent-orchestrator.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query(
      "SELECT id, stage, status, source, started_by, started_at, finished_at FROM process_run WHERE project_id = ? ORDER BY started_at DESC",
    )
    .all(project.id);
  return ok(rows, 200, { count: (rows as unknown[]).length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Agent execution requires the analyst role.");
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  const bodyRaw = await request.json().catch(() => null);
  const body = bodyRaw as { stage?: string } | null;
  if (!body?.stage?.trim() || !/^S[1-7]$/.test(body.stage.trim().toUpperCase())) {
    return badRequest("invalid_request", "stage (S1..S7) is required.");
  }
  const stage = body.stage.trim().toUpperCase();
  const result = await runStageAgents(project.id, project.project_no, stage, ctx.userId, "web");
  return ok(result, 201);
}
