// Single opportunity — update (status transitions, scoring, rationale).
// Status moves identified→assessed→selected|dropped; decided_by/decided_at
// are stamped when the row reaches a terminal-or-selected state.
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../lib/envelope.ts";

const STATUSES = new Set(["identified", "assessed", "selected", "dropped"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const row = getDb()
    .query("SELECT * FROM opportunity WHERE id = ?")
    .get(id);
  if (!row) return notFound();
  return ok(row, 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Opportunity updates require the analyst role.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    name?: string; market_scope?: string; value_chain_node?: string;
    market_size_krw_m?: number; growth_rate?: number;
    attractiveness_score?: number | null; synergy_score?: number | null;
    status?: string; rationale?: string;
  } | null;
  if (!body) return badRequest("invalid_request", "body required.");
  if (body.status && !STATUSES.has(body.status)) {
    return badRequest("invalid_request", `status must be one of ${[...STATUSES].join("|")}.`);
  }
  const score = (v: number | null | undefined) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (!Number.isInteger(v) || v < 0 || v > 100) throw new Error("scores must be integers 0-100");
    return v;
  };
  let attractiveness: number | null | undefined, synergy: number | null | undefined;
  try {
    attractiveness = score(body.attractiveness_score);
    synergy = score(body.synergy_score);
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : "invalid score");
  }

  const db = getDb();
  const existing = db
    .query("SELECT id, status FROM opportunity WHERE id = ?")
    .get(id) as { id: string; status: string } | null;
  if (!existing) return notFound();

  const now = new Date().toISOString();
  const terminal = body.status === "selected" || body.status === "dropped";
  db.run(
    `UPDATE opportunity SET
       name = COALESCE(?, name),
       market_scope = COALESCE(?, market_scope),
       value_chain_node = COALESCE(?, value_chain_node),
       market_size_krw_m = COALESCE(?, market_size_krw_m),
       growth_rate = COALESCE(?, growth_rate),
       attractiveness_score = COALESCE(?, attractiveness_score),
       synergy_score = COALESCE(?, synergy_score),
       status = COALESCE(?, status),
       rationale = COALESCE(?, rationale),
       decided_by = CASE WHEN ? THEN ? ELSE decided_by END,
       decided_at = CASE WHEN ? THEN ? ELSE decided_at END
     WHERE id = ?`,
    [body.name?.trim() ?? null, body.market_scope?.trim() ?? null, body.value_chain_node?.trim() ?? null,
      body.market_size_krw_m ?? null, body.growth_rate ?? null,
      attractiveness ?? null, synergy ?? null, body.status ?? null, body.rationale?.trim() ?? null,
      terminal ? 1 : 0, ctx.userId, terminal ? 1 : 0, now, id],
  );
  appendAudit(db, {
    actor: ctx.userId,
    action: "opportunity_update",
    target: `${id}:${body.status ?? existing.status}`,
    now,
  });
  return ok({ id, status: body.status ?? existing.status });
}

// Delete an opportunity — analyst+ only. Intended for cleaning up test/erroneous
// registrations; blocked when the opportunity has progressed into downstream
// stages (a linked project, route decision, target list, feasibility assessment,
// or synergy analysis references it) so S4+ history is never orphaned.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Opportunity deletion requires the analyst role.");
  const { id } = await params;
  const db = getDb();
  const existing = db
    .query("SELECT id, name, project_id FROM opportunity WHERE id = ?")
    .get(id) as { id: string; name: string; project_id: string | null } | null;
  if (!existing) return notFound();
  if (existing.project_id) {
    return badRequest("opportunity_promoted", "This opportunity is already promoted to a project and cannot be deleted.");
  }
  const blockingTables: Array<[string, string]> = [
    ["route_decision", "진출방식 결정"],
    ["brownfield_target", "타겟 리스트"],
    ["greenfield_assessment", "사업성 평가"],
    ["synergy_analysis", "시너지 분석"],
  ];
  for (const [table, label] of blockingTables) {
    const ref = db.query(`SELECT COUNT(*) c FROM ${table} WHERE opportunity_id = ?`).get(id) as { c: number };
    if (ref.c > 0) {
      return badRequest("opportunity_in_use", `연계된 ${label}(${ref.c}건)이 있어 삭제할 수 없습니다.`);
    }
  }
  db.run("DELETE FROM opportunity WHERE id = ?", [id]);
  appendAudit(db, { actor: ctx.userId, action: "opportunity_delete", target: `${id}:${existing.name}`, now: new Date().toISOString() });
  return ok({ id, deleted: true });
}
