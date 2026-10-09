// @version 1.0.0
// Decision proposals (ADR-0154 §5, Wave M PR M-2) — validation and execution
// mapping shared by /api/proposals and the confirm routes.
//
// A proposal is validated here against the SAME input contract as the decision
// route it will later run through (Zod mirror of the route's checks; the route
// stays the authority and re-validates at confirm). Nothing in this module
// writes a decision: creation goes through db/repositories/decision-proposal
// only, and execution is delegated to the existing decision route handler
// with the confirming human's own session headers.
import { z } from "zod";
import type { ProposalEntityType, ProposalKind } from "../../../db/repositories/decision-proposal.repository.ts";
import { getDb } from "../../../db/client.ts";
import type { DecisionProposal } from "../../../db/repositories/decision-proposal.repository.ts";
import type { AuthContext } from "./auth.ts";
import { PORTFOLIO_TRANSITIONS } from "./process-flow.ts";
import { publicOrigin } from "./mcp/config.ts";
import { visibleProject } from "./project-visibility.ts";

const OPPORTUNITY_GATES = ["screening", "pre_fs", "target_screening"] as const;
const PROJECT_GATES = ["fs", "dd", "entity_ic", "group_ic"] as const;
const CRITERIA = ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"] as const;

const text = z.string().trim().min(1);
const optText = z.string().trim().optional();

const gatePayload = z
  .object({
    gate: z.enum([...OPPORTUNITY_GATES, ...PROJECT_GATES]),
    decision: z.enum(["go", "hold", "kill"]),
    rationale: text,
    // R2-E: carried verbatim into the executed project gate-decisions route —
    // required there for an entity_ic/group_ic GO over open gaps.
    gap_rationale: optText,
    missing_artifacts: z.array(text).optional(),
    learning_capture: optText,
    gate_evaluation_id: optText,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === "hold" && (v.missing_artifacts ?? []).length === 0) {
      ctx.addIssue({ code: "custom", path: ["missing_artifacts"], message: "HOLD requires missing_artifacts." });
    }
    if (v.decision === "kill" && !v.learning_capture) {
      ctx.addIssue({ code: "custom", path: ["learning_capture"], message: "KILL requires learning_capture (ADR-0152)." });
    }
  });

const routePayload = z
  .object({
    track: z.enum(["greenfield", "brownfield"]),
    sub_track: optText,
    rationale: text,
    alternatives_considered: optText,
    intent: z.enum(["integration", "capability_access"]),
    scores: z
      .array(z.object({ criterion: z.enum(CRITERIA), score: z.number().int().min(1).max(3), evidence_note: text }).strict())
      .length(CRITERIA.length),
    gate_evaluation_id: optText,
  })
  .strict();

const adoptionPayload = z.object({ model_id: text }).strict();

const selectionPayload = z.object({ target_id: text, rationale: text.max(4000) }).strict();

const transitionPayload = z
  .object({
    decision: z.enum(PORTFOLIO_TRANSITIONS),
    rationale: text,
    learning_capture: optText,
    tranche_condition: optText,
    core_handoff: optText,
    divest_plan: optText,
    review_cycle: optText,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === "kill_with_learning_captured" && !v.learning_capture) {
      ctx.addIssue({ code: "custom", path: ["learning_capture"], message: "kill_with_learning_captured requires learning_capture." });
    }
  });

/**
 * Human approvals that stamp a human_final review of a stage artifact:
 *  - charter_baseline      (S11, POST charter/confirm — ADR-0104 C3)
 *  - dd_checklist_judgment (S9,  PUT  dd-checklist/state — ADR-0099)
 *  - four_axis_completion  (S10, POST deal-structure complete_four_axis — ADR-0045)
 *  - dd_target_open        (S9,  POST dd/targets — ADR-0157: a SUGGESTION to open comparison DD on
 *                           another shortlisted target; the person who confirms is the one who opens it)
 * An agent acting through a delegated token must not create those rows, so the
 * human performs the approval from the confirm page.
 */
const approvalPayload = z.discriminatedUnion("subject", [
  z.object({ subject: z.literal("charter_baseline") }).strict(),
  z
    .object({
      subject: z.literal("dd_checklist_judgment"),
      checklist_id: text,
      item_id: text,
      status: text,
      note: optText,
      evidence_ref: optText,
      waiver_id: optText,
    })
    .strict(),
  z.object({ subject: z.literal("four_axis_completion"), hypothesis_id: text, artifact_ref: text }).strict(),
  z.object({ subject: z.literal("dd_target_open"), target_id: text, rationale: text }).strict(),
]);

const SCHEMAS: Record<ProposalKind, z.ZodType<Record<string, unknown>>> = {
  gate_decision: gatePayload,
  route_decision: routePayload,
  case_adoption: adoptionPayload,
  target_selection: selectionPayload,
  transition_decision: transitionPayload,
  approval: approvalPayload,
};

export function validatePayload(kind: ProposalKind, payload: unknown): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  const parsed = SCHEMAS[kind].safeParse(payload ?? {});
  if (parsed.success) return { ok: true, payload: parsed.data };
  const message = parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "payload"}: ${i.message}`).join("; ");
  return { ok: false, message };
}

/** The carrier a proposal addresses. A gate fixes it (S1-S7 gates ride the opportunity, S8+ the project). */
export function entityTypeFor(kind: ProposalKind, payload: Record<string, unknown>): ProposalEntityType {
  if (kind === "route_decision") return "opportunity";
  if (kind === "gate_decision") return (OPPORTUNITY_GATES as readonly string[]).includes(String(payload.gate)) ? "opportunity" : "project";
  return "project";
}

export function stageFor(kind: ProposalKind, payload: Record<string, unknown>): string | null {
  switch (kind) {
    case "route_decision":
      return "S4";
    case "case_adoption":
    case "target_selection":
      return "S8";
    case "transition_decision":
      return "S12";
    case "approval":
      return payload.subject === "dd_checklist_judgment" || payload.subject === "dd_target_open" ? "S9" : payload.subject === "four_axis_completion" ? "S10" : "S11";
    case "gate_decision": {
      const gate = String(payload.gate);
      if (gate === "screening") return "S3";
      if (gate === "pre_fs") return "S4";
      if (gate === "target_screening") return "S7";
      if (gate === "fs") return "S8";
      if (gate === "dd") return "S9";
      return "S11";
    }
  }
}

export interface ProposalTarget {
  pattern: string;
  method: "POST" | "PUT";
  path: string;
  body: Record<string, unknown>;
}

/** The existing decision route a confirmed proposal runs through. */
export function targetFor(kind: ProposalKind, entityType: ProposalEntityType, entityId: string, payload: Record<string, unknown>): ProposalTarget {
  const id = encodeURIComponent(entityId);
  switch (kind) {
    case "gate_decision":
      return entityType === "opportunity"
        ? { pattern: "opportunity-gate", method: "POST", path: `/api/opportunities/${id}/gate-decisions`, body: payload }
        : { pattern: "project-gate", method: "POST", path: `/api/projects/${id}/gate-decisions`, body: payload };
    case "route_decision":
      return { pattern: "route-decision", method: "POST", path: `/api/opportunities/${id}/route-decision`, body: payload };
    case "case_adoption":
      return { pattern: "case-adoption", method: "POST", path: `/api/projects/${id}/business-case/adopt`, body: payload };
    case "target_selection":
      return { pattern: "target-selection", method: "POST", path: `/api/projects/${id}/target-selection`, body: payload };
    case "transition_decision":
      return { pattern: "transition-decision", method: "POST", path: `/api/projects/${id}/transition-decision`, body: payload };
    case "approval": {
      const { subject, ...rest } = payload;
      if (subject === "dd_checklist_judgment") {
        return { pattern: "dd-state", method: "PUT", path: `/api/projects/${id}/dd-checklist/state`, body: rest };
      }
      if (subject === "dd_target_open") {
        return { pattern: "dd-target-open", method: "POST", path: `/api/projects/${id}/dd/targets`, body: rest };
      }
      if (subject === "four_axis_completion") {
        return { pattern: "deal-structure", method: "POST", path: `/api/projects/${id}/deal-structure`, body: { action: "complete_four_axis", ...rest } };
      }
      return { pattern: "charter-confirm", method: "POST", path: `/api/projects/${id}/charter/confirm`, body: {} };
    }
  }
}

type Ctx = { params: Promise<Record<string, string>> };
// Method-signature syntax keeps handler parameters bivariant, so the concrete
// Next.js route modules (typed with their own { id } params) are assignable.
interface DecisionModule {
  POST?(request: Request, ctx: Ctx): Promise<Response> | Response;
  PUT?(request: Request, ctx: Ctx): Promise<Response> | Response;
}

// Explicit loaders (Next bundles route modules statically). Only the decision
// and human-approval routes a proposal can execute are listed — closure and PMI kickoff
// have no proposal kind and no loader.
const LOADERS: Record<string, () => Promise<DecisionModule>> = {
  "dd-state": () => import("../app/api/projects/[id]/dd-checklist/state/route.ts"),
  "dd-target-open": () => import("../app/api/projects/[id]/dd/targets/route.ts"),
  "deal-structure": () => import("../app/api/projects/[id]/deal-structure/route.ts"),
  "opportunity-gate": () => import("../app/api/opportunities/[id]/gate-decisions/route.ts"),
  "project-gate": () => import("../app/api/projects/[id]/gate-decisions/route.ts"),
  "route-decision": () => import("../app/api/opportunities/[id]/route-decision/route.ts"),
  "case-adoption": () => import("../app/api/projects/[id]/business-case/adopt/route.ts"),
  "target-selection": () => import("../app/api/projects/[id]/target-selection/route.ts"),
  "transition-decision": () => import("../app/api/projects/[id]/transition-decision/route.ts"),
  "charter-confirm": () => import("../app/api/projects/[id]/charter/confirm/route.ts"),
};

/**
 * Run the existing decision route as the confirming human: the confirm
 * request's own session cookie, CSRF pair, and Origin are forwarded, so the
 * route authenticates the browser session exactly as if the page had posted to
 * it directly. A bearer token can never reach here (the confirm route rejects
 * non-cookie authentication before calling this).
 */
export async function executeTarget(confirmRequest: Request, target: ProposalTarget, entityId: string): Promise<Response> {
  const mod = await LOADERS[target.pattern]();
  const handler = mod[target.method];
  if (!handler) throw new Error(`Decision route '${target.pattern}' has no ${target.method} handler.`);
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of ["cookie", "x-csrf-token", "origin", "host"]) {
    const v = confirmRequest.headers.get(name);
    if (v) headers.set(name, v);
  }
  const url = new URL(target.path, confirmRequest.url);
  const request = new Request(url, { method: target.method, headers, body: JSON.stringify(target.body) });
  return handler.call(mod, request, { params: Promise.resolve({ id: entityId, oppId: entityId }) });
}

export function recordIdOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  for (const key of ["id", "modelId", "targetId"]) {
    if (typeof d[key] === "string") return d[key] as string;
  }
  return null;
}

/** Absolute confirm URL when the origin is known; the in-process synthetic host falls back to a path. */
export function confirmUrl(request: Request, proposalId: string): string {
  const path = `/proposals/${proposalId}/confirm`;
  if (!process.env.CO_NEWBIZ_PUBLIC_ORIGIN?.trim() && new URL(request.url).hostname.endsWith(".invalid")) return path;
  return `${publicOrigin(request)}${path}`;
}

/**
 * Who may see (and decide on) a proposal: its proposer, or anyone who can see
 * the addressed entity. Admins are role-separated from deal content (ADR-0091)
 * and never see proposals. A foreign proposal is indistinguishable from none.
 */
export function proposalVisible(ctx: AuthContext, p: DecisionProposal): boolean {
  if (ctx.role === "admin") return false;
  if (p.proposed_by_user_id === ctx.userId) return true;
  if (p.entity_type === "project") return visibleProject(ctx, p.entity_id, { includeClosed: true }) !== null;
  return getDb().query("SELECT id FROM opportunity WHERE id = ?").get(p.entity_id) !== null;
}
