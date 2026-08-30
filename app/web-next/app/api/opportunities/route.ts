// Opportunity registry — the S2 funnel entity above projects (process-flow.md
// §1.1 invariant #2). One market study yields many opportunities; only
// selected ones are promoted to projects. Opportunities are visible to every
// authenticated user (pre-project intelligence); writes require analyst+.
import { getDb } from "../../../../../db/client.ts";
import { appendAudit } from "../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../lib/envelope.ts";

const STATUSES = new Set(["identified", "assessed", "selected", "dropped"]);

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const projectId = url.searchParams.get("project_id");
  const rows = getDb()
    .query(
      `SELECT id, project_id, name, market_scope, value_chain_node, market_size_krw_m,
              growth_rate, attractiveness_score, synergy_score, status, rationale,
              decided_by, decided_at, created_by, created_at
       FROM opportunity
       WHERE (? IS NULL OR status = ?)
         AND (? IS NULL OR project_id = ?)
       ORDER BY created_at DESC`,
    )
    .all(status, status, projectId, projectId);
  return ok(rows, 200, { count: (rows as unknown[]).length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Opportunity registration requires the analyst role.");
  const body = (await request.json().catch(() => null)) as {
    name?: string; market_scope?: string; value_chain_node?: string;
    market_size_krw_m?: number; growth_rate?: number;
    attractiveness_score?: number; synergy_score?: number;
    status?: string; rationale?: string;
  } | null;
  if (!body?.name?.trim()) return badRequest("invalid_request", "name is required.");
  if (body.status && !STATUSES.has(body.status)) {
    return badRequest("invalid_request", `status must be one of ${[...STATUSES].join("|")}.`);
  }
  const score = (v?: number) => {
    if (v === undefined || v === null) return null;
    if (!Number.isInteger(v) || v < 0 || v > 100) throw new Error("scores must be integers 0-100");
    return v;
  };
  let attractiveness: number | null, synergy: number | null;
  try {
    attractiveness = score(body.attractiveness_score);
    synergy = score(body.synergy_score);
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : "invalid score");
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  const status = body.status ?? (body.synergy_score !== undefined ? "assessed" : "identified");
  db.run(
    `INSERT INTO opportunity (id, project_id, name, market_scope, value_chain_node, market_size_krw_m,
                              growth_rate, attractiveness_score, synergy_score, status, rationale,
                              created_by, created_at)
     VALUES (?,NULL,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, body.name.trim(), body.market_scope?.trim() ?? null, body.value_chain_node?.trim() ?? null,
      body.market_size_krw_m ?? null, body.growth_rate ?? null, attractiveness, synergy,
      status, body.rationale?.trim() ?? null, ctx.userId, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "opportunity_create", target: `${id}:${body.name.trim()}`, now });
  return ok({ id, name: body.name.trim(), status }, 201);
}
