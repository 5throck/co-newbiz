// @version 1.0.0
/**
 * Deal-review routes — docs/api-spec.md §6 (Wave 5.7B).
 *
 * Membership-filtered reads (plus two audited writes) over the deal-review
 * tables migrated in 0005/0011: DD findings, antitrust, incentives,
 * liability exposure, site candidates, partners, permits/certifications,
 * and value-chain links. Every route resolves the project through
 * getProjectIfVisible first — 404 for a non-member, never 403 (FR-SEC-01).
 *
 * Permits and certifications are returned as parallel fields and never
 * merged: a permit lets you operate, a certification lets you sell —
 * different issuers, procedures, and critical paths (design §4-1
 * non-negotiable boundary; migration 0011 keeps the tables separate for
 * exactly this reason).
 */

import { Hono } from "hono";
import { getDb } from "../../db/client.ts";
import { getProjectIfVisible } from "../../db/repositories/project.repository.ts";
import { appendAudit } from "../../db/lib/access-control.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { badRequest, forbidden, notFound, ok } from "./envelope.ts";
import { requireAuth, type AppEnv, type AuthContext } from "./middleware.ts";

export const dealReviewRoutes = new Hono<AppEnv>();
dealReviewRoutes.use("*", requireAuth);

function visibleProject(ctx: AuthContext, projectId: string) {
  return getProjectIfVisible(ctx.userId, projectId, { excludeMnpi: false });
}

/**
 * GET /api/projects/:id/dd-findings — all columns, optional ?category=
 * filter (e.g. rbd), newest first.
 */
dealReviewRoutes.get("/api/projects/:id/dd-findings", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const category = c.req.query("category") || null;
  const rows = getDb()
    .query(
      `SELECT id, category, description, value_impact, assumption_key, evidence_ref,
              trl_grade, ip_ownership_status, commercialization_path, parent_relationship_json,
              rbd_source, created_at
       FROM dd_finding
       WHERE project_id = ? AND (? IS NULL OR category = ?)
       ORDER BY created_at DESC, id DESC`,
    )
    .all(project.id, category, category);
  return ok(c, rows, 200, { count: rows.length });
});

/**
 * POST /api/projects/:id/dd-findings — analyst+; category='rbd' requires
 * rbd_source (validated here first; the engine's CHECK violations still map
 * to 400, never a 500). Audited.
 */
dealReviewRoutes.post("/api/projects/:id/dd-findings", async (c) => {
  const ctx = c.get("auth");
  const project = visibleProject(ctx, c.req.param("id"));
  if (!project) return notFound(c);
  if (ctx.role === "viewer") {
    return forbidden(c, "role_required", "DD findings are recorded by analysts.");
  }
  const body = await c.req.json().catch(() => null) as
    | {
      category?: string;
      description?: string;
      value_impact?: number;
      assumption_key?: string;
      evidence_ref?: string;
      trl_grade?: string;
      ip_ownership_status?: string;
      commercialization_path?: string;
      parent_relationship_json?: string;
      rbd_source?: string;
    }
    | null;
  if (!body?.category?.trim() || !body?.description?.trim()) {
    return badRequest(c, "invalid_request", "category and description are required.");
  }
  if (body.category.trim() === "rbd" && !body.rbd_source?.trim()) {
    return badRequest(
      c,
      "rbd_source_required",
      "category='rbd' requires rbd_source (internal_only|accelerator_partnered|external_technology_acquisition).",
    );
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  try {
    db.run(
      `INSERT INTO dd_finding (id, project_id, category, description, value_impact, assumption_key,
                               evidence_ref, trl_grade, ip_ownership_status, commercialization_path,
                               parent_relationship_json, rbd_source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        project.id,
        body.category.trim(),
        body.description.trim(),
        typeof body.value_impact === "number" ? body.value_impact : null,
        body.assumption_key?.trim() || null,
        body.evidence_ref?.trim() || null,
        body.trl_grade?.trim() || null,
        body.ip_ownership_status?.trim() || null,
        body.commercialization_path?.trim() || null,
        body.parent_relationship_json?.trim() || null,
        body.rbd_source?.trim() || null,
        now,
      ],
    );
  } catch (err) {
    return badRequest(c, "dd_finding_rejected", err instanceof Error ? err.message : "DD finding write failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "dd_finding_add", target: `${project.id}:${body.category.trim()}`, now });
  return ok(c, { id }, 201);
});

/** GET /api/projects/:id/antitrust — antitrust_finding rows. */
dealReviewRoutes.get("/api/projects/:id/antitrust", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query(
      `SELECT id, market_definition, hhi_before, hhi_after, combination_type, filing_jurisdictions,
              remedy_type, remedy_detail, discharge_confirmed_at, created_at
       FROM antitrust_finding WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(project.id);
  return ok(c, rows);
});

/** GET /api/projects/:id/incentives — both directions; meta counts by direction. */
dealReviewRoutes.get("/api/projects/:id/incentives", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query(
      `SELECT id, site_id, direction, type, grantor, program_name, amount, npv_value, currency_id,
              granted_on, application_deadline, construction_deadline, obligation_json, clawback_rule,
              estimated_clawback, negotiability, status, evidence_ref
       FROM incentive WHERE project_id = ? ORDER BY direction, status, id`,
    )
    .all(project.id) as { direction: string }[];
  const byDirection: Record<string, number> = {};
  for (const row of rows) byDirection[row.direction] = (byDirection[row.direction] ?? 0) + 1;
  return ok(c, rows, 200, byDirection);
});

/**
 * GET /api/projects/:id/liabilities — combined exposure: debt instruments,
 * contingent liabilities, and the covenant tests of the project's most
 * recent simulation (simulation -> run -> project; empty arrays when no
 * simulation exists).
 */
dealReviewRoutes.get("/api/projects/:id/liabilities", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const db = getDb();
  const debtInstruments = db
    .query(
      `SELECT id, lender, principal, currency_id, rate_type, rate, maturity, amortization,
              covenant_json, coc_acceleration, security, seniority
       FROM debt_instrument WHERE project_id = ? ORDER BY seniority, id`,
    )
    .all(project.id);
  const contingentLiabilities = db
    .query(
      `SELECT id, category, description, probability, amount_low, amount_expected, amount_high,
              distribution, expected_timing_year, evidence_ref, value_impact
       FROM contingent_liability WHERE project_id = ? ORDER BY expected_timing_year, category`,
    )
    .all(project.id);
  const latest = db
    .query(
      `SELECT s.id FROM simulation s JOIN run r ON r.id = s.run_id
       WHERE r.project_id = ? ORDER BY s.created_at DESC, s.id DESC LIMIT 1`,
    )
    .get(project.id) as { id: string } | null;
  const covenantTests = latest
    ? db
      .query(
        `SELECT period_id, covenant_key, threshold, projected_value, breached
         FROM covenant_test WHERE simulation_id = ? ORDER BY period_id, covenant_key`,
      )
      .all(latest.id)
    : [];
  return ok(
    c,
    { debt_instruments: debtInstruments, contingent_liabilities: contingentLiabilities, covenant_tests: covenantTests },
    200,
    { simulation_id: latest?.id ?? null },
  );
});

/** GET /api/projects/:id/sites — ranked order, unranked candidates last. */
dealReviewRoutes.get("/api/projects/:id/sites", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query(
      `SELECT id, name, region_code, infra_score, infra_capex, incentive_npv, logistics_cost,
              labor_availability, permit_lead_time_days, affected_area_notification_status, total_score, rank
       FROM site_candidate WHERE project_id = ? ORDER BY (rank IS NULL), rank, name`,
    )
    .all(project.id);
  return ok(c, rows);
});

/** GET /api/projects/:id/partners — partner_candidate rows. */
dealReviewRoutes.get("/api/projects/:id/partners", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query(
      `SELECT id, name, partner_type, region_code, capability_score, capacity_score, financial_score,
              compliance_risk, customer_base_fit, dependency_risk, status, contacted_at, nda_signed, evidence_ref
       FROM partner_candidate WHERE project_id = ? ORDER BY name`,
    )
    .all(project.id);
  return ok(c, rows);
});

/**
 * Longest statutory-days path through a permit (or certification) DAG —
 * the regulatory critical path.
 *
 * Kahn's algorithm produces a topological order (edges point from
 * prerequisite to dependent), then one relaxation pass in that order:
 * best[v] = days[v] + max(best[u]) over edges u -> v (just days[v] when v
 * has no prerequisites), with prev[v] recording the maximizing
 * prerequisite. The node with the largest best[] ends the critical path;
 * walking prev[] backwards and reversing yields the id sequence. A cyclic
 * edge set (invalid input — this is a dependency DAG by construction)
 * never enters the topological order, so its nodes are excluded from the
 * path instead of looping forever.
 */
function criticalPath(
  nodes: readonly { id: string; statutory_days: number | null }[],
  edges: readonly { from: string; to: string }[],
): string[] {
  const days = new Map(nodes.map((n) => [n.id, n.statutory_days ?? 0]));
  const succs = new Map<string, string[]>([...days.keys()].map((id) => [id, [] as string[]]));
  const preds = new Map<string, string[]>([...days.keys()].map((id) => [id, [] as string[]]));
  const inDeg = new Map<string, number>([...days.keys()].map((id) => [id, 0]));
  for (const e of edges) {
    if (!days.has(e.from) || !days.has(e.to)) continue; // stay inside this project's subgraph
    succs.get(e.from)!.push(e.to);
    preds.get(e.to)!.push(e.from);
    inDeg.set(e.to, inDeg.get(e.to)! + 1);
  }
  const order: string[] = [];
  const queue = [...inDeg.entries()].filter(([, deg]) => deg === 0).map(([id]) => id);
  while (queue.length > 0) {
    const u = queue.shift()!;
    order.push(u);
    for (const v of succs.get(u)!) {
      inDeg.set(v, inDeg.get(v)! - 1);
      if (inDeg.get(v) === 0) queue.push(v);
    }
  }
  const best = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const v of order) {
    let b = days.get(v)!;
    let p: string | null = null;
    for (const u of preds.get(v)!) {
      const candidate = best.get(u)! + days.get(v)!;
      if (candidate > b) {
        b = candidate;
        p = u;
      }
    }
    best.set(v, b);
    prev.set(v, p);
  }
  let end: string | null = null;
  let endBest = -1;
  for (const [id, b] of best) {
    if (b > endBest) {
      endBest = b;
      end = id;
    }
  }
  const path: string[] = [];
  for (let cur = end; cur !== null; cur = prev.get(cur) ?? null) path.push(cur);
  return path.reverse();
}

/**
 * GET /api/projects/:id/permits — flat lists by default (permits and
 * certifications as parallel fields, never merged); ?include_dag=1 adds a
 * dag object with each kind's edges (joined to this project's rows only)
 * and its statutory-days critical path.
 */
dealReviewRoutes.get("/api/projects/:id/permits", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const db = getDb();
  const permits = db
    .query("SELECT id, name, agency, statutory_days, status FROM permit WHERE project_id = ? ORDER BY name")
    .all(project.id) as { id: string; statutory_days: number | null }[];
  const certifications = db
    .query("SELECT id, name, agency, statutory_days, status FROM certification WHERE project_id = ? ORDER BY name")
    .all(project.id) as { id: string; statutory_days: number | null }[];
  const data: Record<string, unknown> = { permits, certifications };
  if (["1", "true"].includes(c.req.query("include_dag") ?? "")) {
    const permitEdges = (
      db
        .query(
          `SELECT pe.from_permit_id, pe.to_permit_id FROM permit_edge pe
           JOIN permit p ON p.id = pe.from_permit_id WHERE p.project_id = ?`,
        )
        .all(project.id) as { from_permit_id: string; to_permit_id: string }[]
    ).map((e) => ({ from: e.from_permit_id, to: e.to_permit_id }));
    const certificationEdges = (
      db
        .query(
          `SELECT ce.from_certification_id, ce.to_certification_id FROM certification_edge ce
           JOIN certification cr ON cr.id = ce.from_certification_id WHERE cr.project_id = ?`,
        )
        .all(project.id) as { from_certification_id: string; to_certification_id: string }[]
    ).map((e) => ({ from: e.from_certification_id, to: e.to_certification_id }));
    data.dag = {
      permit_edges: permitEdges,
      permit_critical_path: criticalPath(permits, permitEdges),
      certification_edges: certificationEdges,
      certification_critical_path: criticalPath(certifications, certificationEdges),
    };
  }
  return ok(c, data, 200, { permit_count: permits.length, certification_count: certifications.length });
});

/** GET /api/projects/:id/value-chain-links — with industry names on both ends (ADR-0025: never proxy_link's coefficient). */
dealReviewRoutes.get("/api/projects/:id/value-chain-links", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query(
      `SELECT v.id, v.direction, v.elasticity, v.lag_months, v.correlation, v.r2,
              v.pass_through_rate, v.pass_through_lag_months, v.concentration_hhi,
              v.switching_cost_grade, v.substitution_threat, v.evidence_ref, v.assessed_at,
              fi.name_ko AS from_industry_ko, fi.name_en AS from_industry_en,
              ti.name_ko AS to_industry_ko, ti.name_en AS to_industry_en
       FROM value_chain_link v
       JOIN md_industry fi ON fi.id = v.from_industry_id
       JOIN md_industry ti ON ti.id = v.to_industry_id
       WHERE v.project_id = ? ORDER BY v.assessed_at DESC, v.id DESC`,
    )
    .all(project.id);
  return ok(c, rows);
});
