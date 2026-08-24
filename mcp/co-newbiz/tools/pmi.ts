// @version 1.0.0
/**
 * Class C evidence-table surfaces (ADR-0063 write paths) — thin REST wrappers
 * only (ADR-0011): every permission check, audit row, and MNPI gate lives at
 * the REST layer (app/server/pmi.ts); these functions never touch the DB.
 *
 * Money fields are INTEGER KRW millions (ADR-0061); run_rate_bp is basis
 * points of committed cost-synergy run-rate.
 */

import { rest } from "../shared/rest-client.ts";

export async function listKeyTalent(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/pmi/key-talent`);
}

export interface KeyTalentInput {
  projectId: string;
  role_ref: string;
  status?: "active" | "departed_regretted" | "departed_planned";
  exit_date?: string | null;
  locked_at: string;
}

export async function addKeyTalent(input: KeyTalentInput) {
  const { projectId, ...body } = input;
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/pmi/key-talent`, body);
}

export async function listSynergyCertifications(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/pmi/synergy-certifications`);
}

export interface SynergyCertificationInput {
  projectId: string;
  run_rate_bp: number;
  sustained_quarters: number;
  certified_by: string;
  baseline_locked_at: string;
  signed_at: string;
}

export async function addSynergyCertification(input: SynergyCertificationInput) {
  const { projectId, ...body } = input;
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/pmi/synergy-certifications`, body);
}

export async function listDealShapeEvaluations(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/deal-shape-evaluations`);
}

export interface DealShapeEvaluationInput {
  projectId: string;
  shape: string;
  intent: "integration" | "capability_access";
  viable: boolean;
  evaluated_at?: string;
}

export async function addDealShapeEvaluation(input: DealShapeEvaluationInput) {
  const { projectId, ...body } = input;
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/deal-shape-evaluations`, body);
}

export async function listIncentiveDeadlines(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/incentive-deadlines`);
}

export interface IncentiveDeadlineInput {
  projectId: string;
  incentive_ref: string;
  deadline: string;
  source?: string;
}

export async function addIncentiveDeadline(input: IncentiveDeadlineInput) {
  const { projectId, ...body } = input;
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/incentive-deadlines`, body);
}

// ── dimension_input assertion/review (ADR-0063 write paths) ──────────────

export async function listDimensionInputs(projectId: string, varKey?: string) {
  const suffix = varKey ? `?var_key=${encodeURIComponent(varKey)}` : "";
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/dimension-inputs${suffix}`);
}

export interface DimensionInputAssertInput {
  projectId: string;
  run_id: string;
  var_key: string;
  value: { kind: "num" | "text" | "bool"; value: unknown };
  evidence_ref: string;
  rationale: string;
}

export async function assertDimensionInput(input: DimensionInputAssertInput) {
  const { projectId, ...body } = input;
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/dimension-inputs`, body);
}

export async function reviewDimensionInput(projectId: string, rowId: string) {
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/dimension-inputs/${encodeURIComponent(rowId)}/review`);
}
