// @version 1.0.0
/**
 * Governance routes — docs/api-spec.md §5 (Wave 5.6A).
 *
 * Project-scoped reads (RAG, approval chain, compliance, waivers) all pass
 * through getProjectIfVisible first — a non-member gets 404, so no
 * governance detail leaks project existence (FR-SEC-01). RAG responses
 * always include each dimension's `rationale`: ui-spec forbids a color-only
 * signal — the reason line is mandatory UI material, not optional metadata.
 *
 * Procedure resolution wraps scripts/co-newbiz/proc-resolve.ts: the merged
 * shared->region->entity result with per-step `_source` badges is exactly
 * what the procedure viewer renders (FR-SYS-04 territory).
 */

import { Hono } from "hono";
import { getDb } from "../../db/client.ts";
import { getProjectIfVisible } from "../../db/repositories/project.repository.ts";
import { issueWaiver, recordInterpretation, searchInterpretations } from "../../db/lib/compliance.ts";
import { resolveProcedure } from "../../scripts/co-newbiz/proc-resolve.ts";
import { badRequest, fail, forbidden, notFound, ok } from "./envelope.ts";
import { requireAuth, type AppEnv, type AuthContext } from "./middleware.ts";

export const governanceRoutes = new Hono<AppEnv>();
governanceRoutes.use("*", requireAuth);

function visibleProject(ctx: AuthContext, projectId: string) {
  return getProjectIfVisible(ctx.userId, projectId, { excludeMnpi: false });
}

function isLead(ctx: AuthContext, projectId: string): boolean {
  const row = getDb()
    .query("SELECT project_role FROM project_member WHERE project_id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(projectId, ctx.userId) as { project_role: string } | null;
  return row?.project_role === "lead";
}

/**
 * GET /api/projects/:id/rag — latest assessment per dimension. Dimensions
 * assessed in different runs (partial assessment) are returned as-is; the
 * UI renders "평가 미완료" for missing ones, never a default color.
 */
governanceRoutes.get("/api/projects/:id/rag", (c) => {
  const ctx = c.get("auth");
  const project = visibleProject(ctx, c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query(
      "SELECT dimension, grade, triggered_rules, rationale, run_id, assessed_at FROM rag_assessment WHERE project_id = ? ORDER BY assessed_at DESC",
    )
    .all(project.id) as { dimension: string; grade: string; triggered_rules: string; rationale: string; run_id: string; assessed_at: string }[];
  const latestPerDimension = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestPerDimension.has(row.dimension)) latestPerDimension.set(row.dimension, row);
  }
  const dimensions = [...latestPerDimension.values()];
  return ok(c, { project_id: project.id, dimensions }, 200, {
    assessed_at: dimensions.length > 0 ? dimensions[0].assessed_at : null,
    count: dimensions.length,
  });
});

/** GET /api/projects/:id/rag/history — grade transitions, newest first. */
governanceRoutes.get("/api/projects/:id/rag/history", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query("SELECT from_grade, to_grade, run_id, at, reason, notified FROM rag_transition WHERE project_id = ? ORDER BY at DESC, id DESC")
    .all(project.id);
  return ok(c, rows);
});

/** GET /api/projects/:id/approval-chain — entity/group gates in order. */
governanceRoutes.get("/api/projects/:id/approval-chain", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query(
      "SELECT level, gate, sequence, required_procedure_id, approver_role, entity_id, status, decision, decided_at, conditions, blocked_reason FROM approval_chain WHERE project_id = ? ORDER BY level, sequence",
    )
    .all(project.id);
  return ok(c, rows);
});

/** GET /api/projects/:id/compliance-checks */
governanceRoutes.get("/api/projects/:id/compliance-checks", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query("SELECT gate, rule_key, layer, result, detected_at, resolved_at FROM compliance_check WHERE project_id = ? ORDER BY detected_at DESC")
    .all(project.id);
  return ok(c, rows);
});

/** GET /api/projects/:id/waivers */
governanceRoutes.get("/api/projects/:id/waivers", (c) => {
  const project = visibleProject(c.get("auth"), c.req.param("id"));
  if (!project) return notFound(c);
  const rows = getDb()
    .query(
      "SELECT governance_doc_id, clause_ref, reason, requested_by, approver_role, approved_by, approved_at, expires_at, status, created_at FROM waiver WHERE project_id = ? ORDER BY created_at DESC, id DESC",
    )
    .all(project.id);
  return ok(c, rows);
});

/**
 * POST /api/projects/:id/waivers — lead files the request (pending);
 * approve=true additionally activates it and requires admin. expires_at is
 * mandatory and the engine refuses to store an indefinite waiver (ADR-0036).
 */
governanceRoutes.post("/api/projects/:id/waivers", async (c) => {
  const ctx = c.get("auth");
  const project = visibleProject(ctx, c.req.param("id"));
  if (!project) return notFound(c);
  if (!isLead(ctx, project.id)) {
    return forbidden(c, "not_project_lead", "Only the project lead can file a waiver for this project.");
  }
  const body = await c.req.json().catch(() => null) as
    | { governance_doc_id?: string; clause_ref?: string; reason?: string; approver_role?: string; expires_at?: string; approve?: boolean }
    | null;
  if (!body?.governance_doc_id || !body?.clause_ref?.trim() || !body?.reason?.trim() || !body?.approver_role) {
    return badRequest(c, "invalid_request", "governance_doc_id, clause_ref, reason and approver_role are required.");
  }
  if (!body.expires_at) {
    return badRequest(c, "waiver_expiry_required", "expires_at is mandatory — an indefinite waiver is a de facto repeal of its clause (ADR-0036).");
  }
  if (body.approve && ctx.role !== "admin") {
    return forbidden(c, "admin_required", "Activating a waiver at filing time requires the admin role.");
  }
  const now = new Date().toISOString();
  try {
    const id = issueWaiver(getDb(), {
      projectId: project.id,
      governanceDocId: body.governance_doc_id,
      clauseRef: body.clause_ref.trim(),
      reason: body.reason.trim(),
      requestedBy: ctx.userId,
      approverRole: body.approver_role,
      expiresAt: body.expires_at,
      approvedBy: body.approve ? ctx.userId : undefined,
      approvedAt: body.approve ? now : undefined,
      now,
    });
    return ok(c, { id, status: body.approve ? "active" : "pending" }, 201);
  } catch (err) {
    return badRequest(c, "waiver_failed", err instanceof Error ? err.message : "Waiver filing failed.");
  }
});

/** GET /api/interpretations — registry search (workspace-wide, not project-scoped). */
governanceRoutes.get("/api/interpretations", (c) => {
  const rows = searchInterpretations(getDb(), {
    governanceDocId: c.req.query("doc") || undefined,
    clauseRef: c.req.query("clause") || undefined,
    text: c.req.query("q") || undefined,
  });
  return ok(c, rows);
});

/**
 * POST /api/interpretations — record a Q&A pair. Admin-mapped (the account
 * model has no compliance-officer role; see projects.ts module doc) and
 * audited by the engine's supersession guard for contradiction safety.
 */
governanceRoutes.post("/api/interpretations", async (c) => {
  const ctx = c.get("auth");
  if (ctx.role !== "admin") {
    return forbidden(c, "admin_required", "Interpretations are recorded by the governance administrator.");
  }
  const body = await c.req.json().catch(() => null) as
    | { governance_doc_id?: string; clause_ref?: string; question?: string; answer?: string; supersedes?: string; published?: boolean }
    | null;
  if (!body?.governance_doc_id || !body?.clause_ref?.trim() || !body?.question?.trim() || !body?.answer?.trim()) {
    return badRequest(c, "invalid_request", "governance_doc_id, clause_ref, question and answer are required.");
  }
  try {
    const id = recordInterpretation(getDb(), {
      governanceDocId: body.governance_doc_id,
      clauseRef: body.clause_ref.trim(),
      question: body.question.trim(),
      answer: body.answer.trim(),
      askedBy: ctx.userId,
      answeredBy: ctx.userId,
      answeredAt: new Date().toISOString(),
      supersedes: body.supersedes ?? null,
      published: body.published ?? true,
    });
    return ok(c, { id }, 201);
  } catch (err) {
    return fail(c, 409, "interpretation_conflict", err instanceof Error ? err.message : "Interpretation rejected.");
  }
});

/**
 * GET /api/procedures/resolve?procedure=&entity=&region= — merged procedure
 * with per-step source badges (shared/region/entity) for the viewer.
 */
governanceRoutes.get("/api/procedures/resolve", (c) => {
  const procedure = c.req.query("procedure");
  if (!procedure?.trim()) {
    return badRequest(c, "invalid_request", "procedure query parameter is required.");
  }
  try {
    const result = resolveProcedure(procedure.trim(), {
      entity: c.req.query("entity") || undefined,
      region: c.req.query("region") || undefined,
    });
    return ok(c, result, 200, { step_count: result.steps.length });
  } catch {
    return notFound(c, `Procedure '${procedure}' not found.`);
  }
});
