// Pipeline status (ADR-0102 §3) — read-only. Returns the entity's current
// pipeline run (across the promotion handoff: the opportunity segment when
// pre-promotion, the project segment after), its stage, paused_reason, and a
// deep link to the pending human action's screen (static blocker → URL map in
// lib/pipeline.ts). Deny-by-default mirrors the opportunity read routes: no
// opportunity row → 404, unauthenticated → 401.
import { getDb } from "../../../../../../../../db/client.ts";
import { pauseLinkFor, type PipelineRunRow } from "../../../../../../../../app/web-next/lib/pipeline.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, project_id FROM opportunity WHERE id = ?").get(id) as { id: string; project_id: string | null } | undefined;
  if (!opp) return notFound();

  // Latest run across both segments; an active (running/paused) segment wins
  // over a closed one so the widget always reflects the live state.
  const rows = db
    .query(
      `SELECT * FROM pipeline_run
       WHERE (entity_type = 'opportunity' AND entity_id = ?)
          OR (? IS NOT NULL AND entity_type = 'project' AND entity_id = ?)
       ORDER BY started_at DESC, id DESC`,
    )
    .all(opp.id, opp.project_id, opp.project_id) as PipelineRunRow[];
  const run = rows.find((r) => r.status === "running" || r.status === "paused_for_human") ?? rows[0];
  if (!run) return notFound();

  const paused = run.status === "paused_for_human";
  return ok({
    pipeline_run_id: run.id,
    entity_type: run.entity_type,
    entity_id: run.entity_id,
    status: run.status,
    current_stage: run.current_stage,
    paused_reason: run.paused_reason,
    deep_link: paused ? pauseLinkFor(run.paused_reason ?? "", run) : null,
    industry_id: run.industry_id,
    initiating_company_id: run.initiating_company_id,
    started_by: run.started_by,
    started_at: run.started_at,
    updated_at: run.updated_at,
    segments: rows.map((r) => ({ id: r.id, entity_type: r.entity_type, status: r.status, updated_at: r.updated_at })),
  });
});
