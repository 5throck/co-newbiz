// Opportunity registry — the S2 funnel entity above projects (process-flow.md
// §1.1 invariant #2). One market study yields many opportunities; only
// selected ones are promoted to projects. Opportunities are visible to every
// authenticated user (pre-project intelligence); writes require analyst+.
import { getDb } from "../../../../../db/client.ts";
import { appendAudit } from "../../../../../db/lib/access-control.ts";
import { autoLinkSizing } from "../../../lib/sizing-auto-link.ts";

import { ulid } from "../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../lib/envelope.ts";
import { createTarget, KNOWN_TARGET_NOTE_PREFIX } from "../../../lib/brownfield-targets.ts";

const STATUSES = new Set(["identified", "assessed", "selected", "dropped"]);

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  {
    const denied = requireBusinessActor(auth.auth, "read");
    if (denied) return denied;
  }
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const projectId = url.searchParams.get("project_id");
  // includePromoted=1 — also return opportunities promoted to a project and
  // later archived (deleted_at set, but project_id present). Default views
  // (S1~S7 active work) never ask for this; it exists for surfaces that need
  // to let a reviewer navigate to a case's S1~S4 history even after
  // promotion (e.g. the S4 "검토/안건 선택" picker) — genuinely deleted
  // opportunities (no project_id) still never resurface anywhere.
  const includePromoted = url.searchParams.get("includePromoted") === "1";
  const rows = getDb()
    .query(
      `SELECT id, project_id, name, market_scope, industry_id, value_chain_node, market_size_krw_m,
              growth_rate, attractiveness_score, synergy_score, synergy_rationale, synergy_score_confirmed_at, status, rationale,
              decided_by, decided_at, created_by, created_at, deleted_at,
              EXISTS (SELECT 1 FROM route_decision rd WHERE rd.opportunity_id = opportunity.id) AS route_decided,
              -- authoritative "S4 confirmed": a current final decision (ADR-0135); route_decided above also counts drafts
              EXISTS (SELECT 1 FROM route_decision rd WHERE rd.opportunity_id = opportunity.id AND rd.is_current = 1) AS route_confirmed
       FROM opportunity
       WHERE (deleted_at IS NULL OR (? = 1 AND project_id IS NOT NULL))
         AND (? IS NULL OR status = ?)
         AND (? IS NULL OR project_id = ?)
       ORDER BY created_at DESC`,
    )
    .all(includePromoted ? 1 : 0, status, status, projectId, projectId);
  return ok(rows, 200, { count: (rows as unknown[]).length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  {
    const denied = requireBusinessActor(ctx, "write", {
      viewerMessage: "Opportunity registration requires the analyst role.",
    });
    if (denied) return denied;
  }
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    market_scope?: string;
    value_chain_node?: string;
    market_size_krw_m?: number;
    growth_rate?: number;
    attractiveness_score?: number;
    synergy_score?: number;
    status?: string;
    rationale?: string;
    industry_id?: string | null;
    // Wave C-3 (D-5): start from a named target. Pre-fills S6; S1–S4 still apply.
    known_target?: { company_name?: string; dart_corp_code?: string | null; note?: string | null } | null;
  } | null;
  if (!body?.name?.trim()) return badRequest("invalid_request", "name is required.");
  if (body.status === "dropped") {
    return badRequest(
      "typed_closure_required",
      "dropped cannot be set at creation — exclude via POST /api/opportunities/[id]/close (ADR-0152).",
    );
  }
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
  // Wave C-3 (D-3): a hand-registered opportunity can be linked to an analysed
  // industry (the S1 predicate keys on opportunity.industry_id, migration 0126).
  const industryId = body.industry_id?.trim() || null;
  if (industryId && !db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) {
    return badRequest("invalid_industry", "industry_id does not exist in md_industry.");
  }
  const knownTargetName = body.known_target?.company_name?.trim() || null;
  if (body.known_target && !knownTargetName) {
    return badRequest("invalid_request", "known_target.company_name is required.");
  }
  const now = new Date().toISOString();
  const id = ulid();
  const status = body.status ?? (body.synergy_score !== undefined ? "assessed" : "identified");
  db.run(
    `INSERT INTO opportunity (id, project_id, name, market_scope, value_chain_node, market_size_krw_m,
                              growth_rate, attractiveness_score, synergy_score, synergy_rationale, status, rationale,
                              created_by, created_at, industry_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      null,
      body.name.trim(),
      body.market_scope?.trim() ?? null,
      body.value_chain_node?.trim() ?? null,
      body.market_size_krw_m ?? null,
      body.growth_rate ?? null,
      attractiveness,
      synergy,
      null,
      status,
      body.rationale?.trim() ?? null,
      ctx.userId,
      now,
      industryId,
    ],
  );
  appendAudit(db, { actor: ctx.userId, action: "opportunity_create", target: `${id}:${body.name.trim()}`, now });
  // ADR-0179 amendment slice B (auto-link addition): when the industry
  // already has a completed S1 analysis the sizing link is set automatically
  // to its latest completed version (audited `opportunity_sizing_link.auto`).
  // No industry / no completed analysis = no link, nothing fabricated; a
  // manual write later freezes auto forever.
  autoLinkSizing(db, id, ctx.userId, now);
  let knownTargetId: string | null = null;
  if (knownTargetName) {
    // Pre-fill S6: the named target enters the Long List with a discovery
    // source, and the Target Universe is pre-defined around it (min 1
    // candidate). S1–S4 are NOT skipped — the S6 stage stays locked behind them.
    const note = `${KNOWN_TARGET_NOTE_PREFIX} ${body.known_target?.note?.trim() || "사용자가 대상을 직접 지정하여 검토를 시작"}`;
    const target = createTarget(id, knownTargetName, body.known_target?.dart_corp_code?.trim() || null, note, {
      actorUserId: ctx.userId,
    });
    knownTargetId = target.id;
    db.run("UPDATE opportunity SET target_universe_json = ? WHERE id = ?", [
      JSON.stringify({
        definition: `알려진 대상 ${knownTargetName} 기반 검토`,
        criteria: [],
        scope: null,
        min_long_list: 1,
      }),
      id,
    ]);
    appendAudit(db, { actor: ctx.userId, action: "known_target.start", target: `${id}:${knownTargetName}`, now });
  }
  return ok({ id, name: body.name.trim(), status, known_target_id: knownTargetId }, 201);
}
