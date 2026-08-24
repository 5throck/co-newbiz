// @version 1.0.0
/**
 * PMI / deal-shape / incentive-deadline routes — the write surfaces for the
 * Class C evidence tables (migration 0026, ADR-0063).
 *
 * These records feed kill-criteria snapshot vars (#4/#14/#28/#29), so every
 * write is audited and every read is project-visible-gated: a non-member
 * gets 404, never 403 (FR-SEC-01). Writes require the analyst role — viewers
 * observe, they do not file rosters or certifications (the same gate as
 * assumption writes; role elevation is a separate admin act).
 *
 * Unit convention: money fields here are INTEGER KRW millions (ADR-0061) —
 * run_rate_bp is basis points of committed cost-synergy run-rate.
 */

import { Hono } from "hono";
import { getDb } from "../../db/client.ts";
import { getProjectIfVisible } from "../../db/repositories/project.repository.ts";
import { appendAudit } from "../../db/lib/access-control.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { badRequest, forbidden, notFound, ok } from "./envelope.ts";
import { requireAuth, type AppEnv, type AuthContext } from "./middleware.ts";

export const pmiRoutes = new Hono<AppEnv>();
pmiRoutes.use("*", requireAuth);

function visibleProject(ctx: AuthContext, projectId: string) {
  return getProjectIfVisible(ctx.userId, projectId, { excludeMnpi: false });
}

const KEY_TALENT_STATUSES = ["active", "departed_regretted", "departed_planned"] as const;

pmiRoutes.get("/api/projects/:id/pmi/key-talent", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query("SELECT id, role_ref, status, exit_date, locked_at FROM pmi_key_talent WHERE project_id = ? ORDER BY locked_at DESC, id")
    .all(project.id);
  return ok(c, rows);
});

pmiRoutes.post("/api/projects/:id/pmi/key-talent", async (c) => {
  const ctx = c.get("auth");
  const project = visibleProject(ctx, c.req.param("id"));
  if (!project) return notFound(c);
  if (ctx.role === "viewer") return forbidden(c, "role_required", "Key-talent writes require the analyst role.");
  const body = await c.req.json().catch(() => null) as
    | { role_ref?: string; status?: string; exit_date?: string | null; locked_at?: string }
    | null;
  if (!body?.role_ref?.trim() || !body?.locked_at) {
    return badRequest(c, "invalid_request", "role_ref and locked_at are required.");
  }
  const status = body.status ?? "active";
  if (!KEY_TALENT_STATUSES.includes(status as never)) {
    return badRequest(c, "invalid_status", `status must be one of ${KEY_TALENT_STATUSES.join(", ")}.`);
  }
  if ((status === "active") === (body.exit_date != null && body.exit_date !== "")) {
    return badRequest(c, "status_exit_mismatch", "active rows carry no exit_date; departed rows carry one.");
  }
  if (!/^[A-Z]-[A-Z0-9]{2}-[0-9]{3}$/.test(body.role_ref.trim())) {
    return badRequest(c, "invalid_role_ref", "role_ref must be a role key like 'C-EO-001' — never a person's name (ADR-0039).");
  }
  const db = getDb();
  const id = ulid();
  try {
    db.run(
      "INSERT INTO pmi_key_talent (id, project_id, role_ref, status, exit_date, locked_at, created_at) VALUES (?,?,?,?,?,?,?)",
      [id, project.id, body.role_ref.trim(), status, body.exit_date ?? null, body.locked_at, new Date().toISOString()],
    );
  } catch (err) {
    return badRequest(c, "key_talent_failed", err instanceof Error ? err.message : "Key-talent insert failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "pmi_key_talent_write", target: `${project.id}:${id}`, now: new Date().toISOString() });
  return ok(c, { id, status }, 201);
});

pmiRoutes.get("/api/projects/:id/pmi/synergy-certifications", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query("SELECT id, run_rate_bp, sustained_quarters, certified_by, baseline_locked_at, signed_at FROM pmi_synergy_certification WHERE project_id = ? ORDER BY signed_at DESC")
    .all(project.id);
  return ok(c, rows);
});

pmiRoutes.post("/api/projects/:id/pmi/synergy-certifications", async (c) => {
  const ctx = c.get("auth");
  const project = visibleProject(ctx, c.req.param("id"));
  if (!project) return notFound(c);
  if (ctx.role === "viewer") return forbidden(c, "role_required", "Certification writes require the analyst role.");
  const body = await c.req.json().catch(() => null) as
    | { run_rate_bp?: number; sustained_quarters?: number; certified_by?: string; baseline_locked_at?: string; signed_at?: string }
    | null;
  if (
    typeof body?.run_rate_bp !== "number" || body.run_rate_bp < 0 || body.run_rate_bp > 10000 ||
    typeof body?.sustained_quarters !== "number" || body.sustained_quarters < 1 ||
    !body?.certified_by?.trim() || !body?.baseline_locked_at || !body?.signed_at
  ) {
    return badRequest(c, "invalid_request", "run_rate_bp (0-10000), sustained_quarters (>=1), certified_by, baseline_locked_at and signed_at are required.");
  }
  const db = getDb();
  const id = ulid();
  try {
    db.run(
      "INSERT INTO pmi_synergy_certification (id, project_id, run_rate_bp, sustained_quarters, certified_by, baseline_locked_at, signed_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, project.id, Math.round(body.run_rate_bp), Math.round(body.sustained_quarters), body.certified_by.trim(), body.baseline_locked_at, body.signed_at, new Date().toISOString()],
    );
  } catch (err) {
    return badRequest(c, "certification_failed", err instanceof Error ? err.message : "Certification insert failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "synergy_certification_write", target: `${project.id}:${id}`, now: new Date().toISOString() });
  return ok(c, { id }, 201);
});

const SHAPE_ENUM = ["full_acquisition", "majority_stake", "spv", "holdco_route", "joint_venture", "minority_stake", "license_in", "co_development"] as const;

pmiRoutes.get("/api/projects/:id/deal-shape-evaluations", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query("SELECT id, shape, intent, viable, evaluated_by, evaluated_at FROM deal_shape_evaluation WHERE project_id = ? ORDER BY evaluated_at DESC, id")
    .all(project.id);
  return ok(c, rows);
});

pmiRoutes.post("/api/projects/:id/deal-shape-evaluations", async (c) => {
  const ctx = c.get("auth");
  const project = visibleProject(ctx, c.req.param("id"));
  if (!project) return notFound(c);
  if (ctx.role === "viewer") return forbidden(c, "role_required", "Deal-shape evaluation writes require the analyst role.");
  const body = await c.req.json().catch(() => null) as
    | { shape?: string; intent?: string; viable?: boolean; evaluated_at?: string }
    | null;
  if (!body?.shape || !SHAPE_ENUM.includes(body.shape as never)) {
    return badRequest(c, "invalid_shape", `shape must be one of ${SHAPE_ENUM.join(", ")}.`);
  }
  if (body.intent !== "integration" && body.intent !== "capability_access") {
    return badRequest(c, "invalid_intent", "intent must be 'integration' or 'capability_access'.");
  }
  if (typeof body.viable !== "boolean") {
    return badRequest(c, "invalid_viable", "viable is required (boolean).");
  }
  const db = getDb();
  const id = ulid();
  try {
    db.run(
      "INSERT INTO deal_shape_evaluation (id, project_id, shape, intent, viable, evaluated_by, evaluated_at) VALUES (?,?,?,?,?,?,?)",
      [id, project.id, body.shape, body.intent, body.viable ? 1 : 0, ctx.userId, body.evaluated_at ?? new Date().toISOString()],
    );
  } catch (err) {
    return badRequest(c, "shape_evaluation_failed", err instanceof Error ? err.message : "Evaluation insert failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "deal_shape_evaluation_write", target: `${project.id}:${id}`, now: new Date().toISOString() });
  return ok(c, { id }, 201);
});

pmiRoutes.get("/api/projects/:id/incentive-deadlines", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query("SELECT id, incentive_ref, deadline, source, created_at FROM project_incentive_deadline WHERE project_id = ? ORDER BY deadline ASC")
    .all(project.id);
  return ok(c, rows);
});

pmiRoutes.post("/api/projects/:id/incentive-deadlines", async (c) => {
  const ctx = c.get("auth");
  const project = visibleProject(ctx, c.req.param("id"));
  if (!project) return notFound(c);
  if (ctx.role === "viewer") return forbidden(c, "role_required", "Incentive-deadline writes require the analyst role.");
  const body = await c.req.json().catch(() => null) as
    | { incentive_ref?: string; deadline?: string; source?: string }
    | null;
  if (!body?.incentive_ref?.trim() || !body?.deadline || Number.isNaN(Date.parse(body.deadline))) {
    return badRequest(c, "invalid_request", "incentive_ref and a parseable deadline are required.");
  }
  const db = getDb();
  const id = ulid();
  try {
    db.run(
      "INSERT INTO project_incentive_deadline (id, project_id, incentive_ref, deadline, source, created_at) VALUES (?,?,?,?,?,?)",
      [id, project.id, body.incentive_ref.trim(), body.deadline, body.source?.trim() || null, new Date().toISOString()],
    );
  } catch (err) {
    return badRequest(c, "deadline_failed", err instanceof Error ? err.message : "Deadline insert failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "incentive_deadline_write", target: `${project.id}:${id}`, now: new Date().toISOString() });
  return ok(c, { id }, 201);
});
