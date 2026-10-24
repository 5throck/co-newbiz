// @version 1.0.0
/**
 * ic-review-steps — the S11 투자심사 procedure made visible (2026-10-21).
 * procedures/_shared/entity-ic-review (steps 1·2·3/3.1·4·4.5·4.6·5) and
 * group-investment-review (1·2·3·4·4.5·5) were, in the workspace, only their
 * first and last steps. This module computes every step's status from its
 * ledger of record and records the intermediate human steps in
 * ic_review_step_record (migration 0163):
 *
 *   derived — step 1 (AI-proposed RAG: rag_assessment), step 4's fact
 *             (certainty of funds: financing_sources_uses evidence, 0162),
 *             step 5 / group step 1·5 (gate_decision);
 *   ledger  — step 2 (explicit Kill Criteria pass/fail per applicable
 *             criterion; the engine's kill_criteria_evaluation outcome is shown
 *             as a PROPOSAL next to each), step 3 (IC memo snapshot + hash),
 *             step 4's confirmation, 4.5, 4.6 and the group-review findings.
 *
 * Nothing here decides: a failed step is a gap the IC reads (icStepGapItems
 * feeds the GO-gap warning + rationale override pattern), never a block.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { readRagView } from "../../../db/lib/rag-service.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { getHypotheses } from "../../../db/repositories/deal-structure-hypothesis.repository.ts";
import { financingCertainty, financingTotals, type FinancingCertainty } from "../../../db/repositories/financing-plan.repository.ts";
import { findAdoptedCase, listBusinessCases } from "./business-case.ts";
import { buildBriefingPack } from "./briefing-pack.ts";
import { ddCompletionSummary } from "./dd-checklist-tailor.ts";
import { establishmentProgress } from "./establishment.ts";
import { latestGateDecisions } from "./process-flow.ts";
import { buildRiskHeatmap, heatmapSnapshot } from "./risk-heatmap.ts";

type Db = ReturnType<typeof getDb>;

/**
 * procedures/_kill-criteria/<procedure>__*.json — resolved from this file's URL
 * (the sim-engine pattern): db/lib/kill-criteria.ts's `import.meta.dir` is
 * Bun-only and undefined under the Next server bundle, so the web app cannot
 * import that loader.
 */
const REGISTRY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "procedures", "_kill-criteria");

export interface RegistryEntry {
  procedure: string;
  criterion_id: string;
  title?: string;
  action: string;
  enabled?: boolean;
}

export function loadKillCriteriaRegistry(procedure: string): RegistryEntry[] {
  let files: string[] = [];
  try {
    files = readdirSync(REGISTRY_DIR).filter((f) => f.startsWith(`${procedure}__`) && f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: RegistryEntry[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(REGISTRY_DIR, f), "utf-8")) as RegistryEntry;
      if (raw?.criterion_id) out.push(raw);
    } catch {
      // an unparsable registry file is a repo defect caught by procedures:lint — skip here, never invent
    }
  }
  return out.sort((a, b) => a.criterion_id.localeCompare(b.criterion_id));
}

export type IcProcedure = "entity-ic-review" | "group-investment-review";
export type StepSource = "derived" | "ledger" | "derived+ledger";
export type StepStatus = "pending" | "incomplete" | "pass" | "fail" | "recorded";
export type RecordStatus = "pass" | "fail" | "na" | "recorded";
export type Verdict = "pass" | "fail" | "na";

export interface StepDef {
  id: string;
  output_type: string;
  title: string;
  agent: string;
  source: StepSource;
  human?: boolean;
}

export const ENTITY_IC_STEPS: StepDef[] = [
  { id: "1", output_type: "rag_assessment_proposed", title: "종합 등급 제안 (AI — 결정 아님)", agent: "risk-officer", source: "derived" },
  { id: "2", output_type: "kill_criteria_check", title: "Kill Criteria 명시적 pass/fail", agent: "process-governance-manager", source: "ledger" },
  { id: "3", output_type: "ic_memo", title: "IC 메모 스냅샷", agent: "brownfield-agent / greenfield-agent", source: "ledger" },
  { id: "4", output_type: "financing_readiness_check", title: "자금확정성 선결조건 (사실 확인)", agent: "valuation-agent", source: "derived+ledger" },
  { id: "4.5", output_type: "integrated_insight_review", title: "통합 인사이트 리뷰", agent: "process-governance-manager", source: "ledger" },
  { id: "4.6", output_type: "entity_ic_decision_deck", title: "의사결정 덱", agent: "docs-writer", source: "ledger" },
  { id: "5", output_type: "entity_ic_decision", title: "법인 투자심의위원회 결정 (사람)", agent: "entity-ic-reviewer", source: "derived", human: true },
];

export const GROUP_IC_STEPS: StepDef[] = [
  { id: "1", output_type: "entity_ic_precondition_check", title: "법인 투자심의위원회 승인 선결", agent: "process-governance-manager", source: "derived" },
  { id: "2", output_type: "portfolio_overlap_finding", title: "포트폴리오 중복 노출 검토", agent: "group-review-agent", source: "ledger" },
  { id: "3", output_type: "related_party_transaction_finding", title: "계열사 간 거래 검토 (공정거래법 47조)", agent: "group-review-agent", source: "ledger" },
  { id: "4", output_type: "group_agenda_ranking", title: "그룹 안건 우선순위", agent: "group-review-agent", source: "ledger" },
  { id: "4.5", output_type: "group_ic_decision_deck", title: "의사결정 덱", agent: "docs-writer", source: "ledger" },
  { id: "5", output_type: "group_ic_decision", title: "그룹 투자심의위원회 결정 (사람)", agent: "process-governance-manager", source: "derived", human: true },
];

export interface StepRecordRow {
  id: string;
  project_id: string;
  procedure: IcProcedure;
  step_id: string;
  output_type: string;
  status: RecordStatus;
  payload_json: string | null;
  evidence_ref: string | null;
  recorded_by: string;
  recorded_at: string;
}

export interface KillCriterionView {
  key: string;
  procedure: string;
  criterion_id: string;
  title: string;
  action: string;
  enabled: boolean;
  /** Latest engine evaluation outcome (kill_criteria_evaluation, 0023) — a proposal; null when no run evaluated it. */
  automated: "triggered" | "false" | "unassessed" | null;
  /** The person's explicit verdict from the latest step-2 record; null until recorded. */
  verdict: Verdict | null;
}

export interface StepView extends StepDef {
  status: StepStatus;
  latest: StepRecordRow | null;
  detail: Record<string, unknown>;
}

export interface IcReviewStepsView {
  entity: StepView[];
  group: StepView[];
  kill_criteria: KillCriterionView[];
  financing: FinancingCertainty & { balanced: boolean };
  gaps: string[];
}

export class IcReviewStepError extends Error {}

/** Procedures whose kill criteria an IC must see answered for this project (project-stage procedures only). */
export function applicableKillProcedures(db: Db, projectId: string): string[] {
  const p = db.query("SELECT track, origin FROM md_project WHERE id = ?").get(projectId) as { track: string | null; origin: string | null } | undefined;
  const list = ["entity-ic-review"];
  if (p?.track === "brownfield") list.push("brownfield-fs", "brownfield-fs-comparative", "brownfield-dd");
  else if (p?.track === "greenfield") list.push("greenfield-dd");
  if (p?.origin === "internal" || p?.origin === "joint") {
    list.push(establishmentProgress(projectId).mode === "business_unit" ? "business-unit-establishment-execution" : "entity-establishment-execution");
  }
  return list;
}

function latestRecord(db: Db, projectId: string, procedure: IcProcedure, stepId: string): StepRecordRow | null {
  return (db
    .query(
      `SELECT * FROM ic_review_step_record WHERE project_id = ? AND procedure = ? AND step_id = ?
       ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId, procedure, stepId) as StepRecordRow | undefined) ?? null;
}

function parsePayload(row: StepRecordRow | null): Record<string, unknown> {
  if (!row?.payload_json) return {};
  try {
    return JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function killCriteriaView(db: Db, projectId: string, step2: StepRecordRow | null): KillCriterionView[] {
  const verdicts = (parsePayload(step2).verdicts ?? {}) as Record<string, Verdict>;
  const out: KillCriterionView[] = [];
  for (const procedure of applicableKillProcedures(db, projectId)) {
    const entries = loadKillCriteriaRegistry(procedure);
    for (const e of entries) {
      const auto = db
        .query(
          `SELECT outcome FROM kill_criteria_evaluation WHERE project_id = ? AND procedure_key = ? AND criterion_id = ?
           ORDER BY evaluated_at DESC LIMIT 1`,
        )
        .get(projectId, procedure, e.criterion_id) as { outcome: "triggered" | "false" | "unassessed" } | undefined;
      const key = `${procedure}:${e.criterion_id}`;
      out.push({
        key, procedure, criterion_id: e.criterion_id, title: e.title ?? e.criterion_id, action: e.action, enabled: e.enabled !== false,
        automated: auto?.outcome ?? null,
        verdict: verdicts[key] ?? null,
      });
    }
  }
  return out;
}

export function icReviewStepsView(db: Db, projectId: string): IcReviewStepsView {
  const gates = latestGateDecisions("project", projectId);
  const rag = readRagView(db, projectId);
  const certainty = financingCertainty(projectId, db);
  const totals = financingTotals(projectId, db);
  const financing = { ...certainty, balanced: totals.balanced };
  const financingPass = totals.balanced && certainty.all_sources_evidenced;

  const step2 = latestRecord(db, projectId, "entity-ic-review", "2");
  const criteria = killCriteriaView(db, projectId, step2);
  const unanswered = criteria.filter((c) => c.verdict === null).length;
  const failed = criteria.filter((c) => c.verdict === "fail").length;

  const entity: StepView[] = ENTITY_IC_STEPS.map((def) => {
    const latest = def.source === "derived" ? null : latestRecord(db, projectId, "entity-ic-review", def.id);
    let status: StepStatus = latest ? "recorded" : "pending";
    const detail: Record<string, unknown> = {};
    switch (def.id) {
      case "1":
        status = rag.status === "graded" ? "recorded" : "pending";
        detail.grade = rag.overall?.grade ?? null;
        break;
      case "2":
        if (!step2) status = "pending";
        else if (unanswered > 0) status = "incomplete";
        else status = failed > 0 ? "fail" : "pass";
        Object.assign(detail, { criteria: criteria.length, unanswered, failed });
        break;
      case "3":
        detail.snapshot_hash = parsePayload(latest).snapshot_hash ?? null;
        break;
      case "4":
        status = financingPass ? "pass" : "fail";
        Object.assign(detail, { balanced: totals.balanced, all_sources_evidenced: certainty.all_sources_evidenced, unevidenced_lines: certainty.unevidenced_lines, unevidenced_amount_krw_m: certainty.unevidenced_amount_krw_m, confirmed: Boolean(latest) });
        break;
      case "5": {
        const v = gates.get("entity_ic");
        status = v ? "recorded" : "pending";
        detail.decision = v?.decision ?? null;
        break;
      }
      default:
        break;
    }
    return { ...def, status, latest, detail };
  });

  const group: StepView[] = GROUP_IC_STEPS.map((def) => {
    const latest = def.source === "derived" ? null : latestRecord(db, projectId, "group-investment-review", def.id);
    let status: StepStatus = latest ? "recorded" : "pending";
    const detail: Record<string, unknown> = {};
    if (def.id === "1") {
      const v = gates.get("entity_ic");
      status = v?.decision === "go" ? "pass" : "fail";
      detail.entity_decision = v?.decision ?? null;
    } else if (def.id === "5") {
      const v = gates.get("group_ic");
      status = v ? "recorded" : "pending";
      detail.decision = v?.decision ?? null;
    }
    return { ...def, status, latest, detail };
  });

  const gaps: string[] = [];
  const s2 = entity.find((s) => s.id === "2")!;
  if (s2.status === "pending") gaps.push("투자심사 절차 Kill Criteria 체크 미기록 (step 2)");
  else if (s2.status === "incomplete") gaps.push(`Kill Criteria 미판정 ${unanswered}건 (step 2)`);
  else if (s2.status === "fail") gaps.push(`Kill Criteria 미충족 ${failed}건 (step 2)`);
  if (entity.find((s) => s.id === "3")!.status === "pending") gaps.push("IC 메모 스냅샷 미기록 (step 3)");
  if (!financingPass) {
    gaps.push(
      totals.balanced
        ? `자금확정성 선결 미충족 — 증빙 없는 조달 ${certainty.unevidenced_lines}건 (${certainty.unevidenced_amount_krw_m} 백만 KRW) (step 4)`
        : "자금확정성 선결 미충족 — sources & uses 미균형 (step 4)",
    );
  }
  return { entity, group, kill_criteria: criteria, financing, gaps };
}

/** The IC-GO gap labels this module contributes (read by ic-gap-override). */
export function icStepGapItems(db: Db, projectId: string): string[] {
  try {
    return icReviewStepsView(db, projectId).gaps;
  } catch {
    return [];
  }
}

export interface RecordIcStepInput {
  projectId: string;
  procedure: IcProcedure;
  stepId: string;
  payload?: Record<string, unknown> | null;
  evidenceRef?: string | null;
  by: string;
  at?: string;
}

function insertRecord(db: Db, input: RecordIcStepInput, def: StepDef, status: RecordStatus, payload: Record<string, unknown> | null): StepRecordRow {
  const at = input.at ?? new Date().toISOString();
  const id = ulid();
  db.transaction(() => {
    db.run(
      `INSERT INTO ic_review_step_record (id, project_id, procedure, step_id, output_type, status, payload_json, evidence_ref, recorded_by, recorded_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, input.projectId, input.procedure, def.id, def.output_type, status, payload ? JSON.stringify(payload) : null, input.evidenceRef?.trim() || null, input.by, at],
    );
    appendAudit(db, { actor: input.by, action: "ic_review_step.recorded", target: `${input.projectId}:${input.procedure}:${def.id}:${status}`, now: at });
  })();
  return db.query("SELECT * FROM ic_review_step_record WHERE id = ?").get(id) as StepRecordRow;
}

/**
 * Record one intermediate step. Derived steps are refused (their ledgers are
 * elsewhere). Step 2 requires a verdict for EVERY applicable criterion;
 * step 4 stores the derived fact (a person confirms, never overrides);
 * the remaining ledger steps need a reference or a note of substance.
 */
export function recordIcReviewStep(db: Db, input: RecordIcStepInput): StepRecordRow {
  const defs = input.procedure === "entity-ic-review" ? ENTITY_IC_STEPS : input.procedure === "group-investment-review" ? GROUP_IC_STEPS : null;
  if (!defs) throw new IcReviewStepError("procedure must be entity-ic-review or group-investment-review.");
  const def = defs.find((d) => d.id === input.stepId);
  if (!def) throw new IcReviewStepError(`step_id '${input.stepId}' is not in the ${input.procedure} procedure.`);
  if (def.source === "derived") throw new IcReviewStepError(`step ${def.id} (${def.output_type}) is derived from another ledger and cannot be recorded here.`);
  const payload = input.payload ?? null;

  if (input.procedure === "entity-ic-review" && def.id === "2") {
    const verdicts = (payload?.verdicts ?? null) as Record<string, unknown> | null;
    if (!verdicts || typeof verdicts !== "object") throw new IcReviewStepError("payload.verdicts ({ '<procedure>:<criterion_id>': pass|fail|na }) is required.");
    const applicable = killCriteriaView(db, input.projectId, null);
    const known = new Set(applicable.map((c) => c.key));
    const clean: Record<string, Verdict> = {};
    for (const [k, v] of Object.entries(verdicts)) {
      if (!known.has(k)) throw new IcReviewStepError(`'${k}' is not a Kill Criterion applicable to this project.`);
      if (v !== "pass" && v !== "fail" && v !== "na") throw new IcReviewStepError(`the verdict for '${k}' must be pass | fail | na.`);
      clean[k] = v;
    }
    const missing = applicable.filter((c) => !clean[c.key]).map((c) => c.key);
    if (missing.length > 0) throw new IcReviewStepError(`every Kill Criterion needs an explicit verdict — missing: ${missing.join(", ")}`);
    const note = typeof payload?.note === "string" ? payload.note.trim() : "";
    const failed = Object.values(clean).filter((v) => v === "fail").length;
    return insertRecord(db, input, def, failed > 0 ? "fail" : "pass", { verdicts: clean, note: note || null, failed });
  }

  if (input.procedure === "entity-ic-review" && def.id === "3") {
    throw new IcReviewStepError("IC memos are created and recorded via the snapshot_ic_memo action.");
  }

  if (input.procedure === "entity-ic-review" && def.id === "4") {
    const certainty = financingCertainty(input.projectId, db);
    const totals = financingTotals(input.projectId, db);
    const pass = totals.balanced && certainty.all_sources_evidenced;
    return insertRecord(db, input, def, pass ? "pass" : "fail", { balanced: totals.balanced, ...certainty });
  }

  const note = typeof payload?.note === "string" ? payload.note.trim() : "";
  if (!input.evidenceRef?.trim() && note.length < 10) {
    throw new IcReviewStepError("evidence_ref or a note of at least 10 characters is required — steps cannot be recorded without evidence.");
  }
  return insertRecord(db, input, def, "recorded", { note: note || null });
}

/** The IC memo content from the ledgers of record (also the context the step-4.5 insight draft reads). */
export function buildIcMemo(db: Db, projectId: string, note?: string | null): { memo: Record<string, unknown>; snapshot_hash: string } {
  const list = listBusinessCases(projectId);
  const adopted = findAdoptedCase(list);
  const rag = readRagView(db, projectId);
  const completion = ddCompletionSummary(projectId);
  const findings = db
    .query("SELECT id, category, description, value_impact FROM dd_finding WHERE project_id = ? AND target_id IS NULL ORDER BY created_at DESC, id LIMIT 10")
    .all(projectId) as Array<Record<string, unknown>>;
  const hypothesis = getHypotheses(projectId, db)[0] ?? null;
  const certainty = financingCertainty(projectId, db);
  const totals = financingTotals(projectId, db);
  const step2 = latestRecord(db, projectId, "entity-ic-review", "2");
  const memo = {
    generated_at: new Date().toISOString(),
    business_case: adopted ? { id: adopted.id, name: adopted.name, scenario: adopted.scenario, p50: adopted.simulations.find((s) => s.percentile === "p50")?.npv_krw_m ?? null } : null,
    rag: { status: rag.status, grade: rag.overall?.grade ?? null, confidence_cap: rag.dimensions.data_confidence?.grade ?? null, is_proposal: true },
    dd: { completion, top_findings: findings },
    deal_structure: hypothesis
      ? { vehicle: hypothesis.vehicle, stake_type: hypothesis.stake_type, four_axis_review_completed: hypothesis.four_axis_review_completed === 1, four_axis_artifact_ref: hypothesis.four_axis_artifact_ref ?? null }
      : null,
    financing: { balanced: totals.balanced, sources: totals.sources, uses: totals.uses, ...certainty },
    kill_criteria: step2 ? parsePayload(step2) : null,
    risk_heatmap: heatmapSnapshot(buildRiskHeatmap(db, projectId), 5),
    note: note?.trim() || null,
  };
  const snapshot_hash = createHash("sha256").update(JSON.stringify({ ...memo, generated_at: undefined })).digest("hex").slice(0, 16);
  return { memo, snapshot_hash };
}

/** Build the IC memo from the ledgers of record and record it as step 3 with a content hash. */
export function snapshotIcMemo(db: Db, projectId: string, by: string, note?: string | null): StepRecordRow {
  const { memo, snapshot_hash } = buildIcMemo(db, projectId, note);
  const def = ENTITY_IC_STEPS.find((d) => d.id === "3")!;
  return insertRecord(db, { projectId, procedure: "entity-ic-review", stepId: "3", by }, def, "recorded", { ...memo, snapshot_hash });
}

/**
 * Step 4.6 — the decision deck. In this workspace the committee's deck is the
 * deterministic briefing pack (E1, ADR-0104 §pipeline): build it, hash it,
 * and record 4.6 with the hash as the evidence reference. The pack itself is
 * returned to the caller for display; nothing but the record is stored.
 */
export function attachDecisionDeck(db: Db, projectId: string, by: string): { row: StepRecordRow; pack: string; pack_hash: string } {
  const pack = buildBriefingPack(db, { type: "project", id: projectId });
  const pack_hash = createHash("sha256").update(pack).digest("hex").slice(0, 16);
  const def = ENTITY_IC_STEPS.find((d) => d.id === "4.6")!;
  const row = insertRecord(
    db,
    { projectId, procedure: "entity-ic-review", stepId: "4.6", by, evidenceRef: `briefing-pack:${pack_hash}` },
    def,
    "recorded",
    { pack_hash, pack_chars: pack.length, generated_at: new Date().toISOString() },
  );
  return { row, pack, pack_hash };
}

/** Deterministic step-4.5 fallback when no LLM is configured — counts only, no judgement. */
export function insightFallback(view: IcReviewStepsView, memo: Record<string, unknown>): { synthesis: string; tensions: string[]; open_questions: string[]; recommendation_note: string } {
  const s2 = view.entity.find((s) => s.id === "2")!;
  const s4 = view.entity.find((s) => s.id === "4")!;
  const heat = memo.risk_heatmap as { counts?: { high: number; mid: number; low: number } } | undefined;
  return {
    synthesis: `결정론 폴백 — Kill Criteria ${view.kill_criteria.length}건 중 미판정 ${Number(s2.detail.unanswered ?? view.kill_criteria.length)}건·미충족 ${Number(s2.detail.failed ?? 0)}건, 자금확정성 ${s4.status === "pass" ? "충족" : "미충족"}, 리스크 높음 ${heat?.counts?.high ?? 0}건이 기록되어 있습니다. 차원 간 통합 해석은 LLM 구성 후 생성하거나 사람이 직접 작성하세요.`,
    tensions: [],
    open_questions: view.gaps,
    recommendation_note: "결정론 폴백 — 권고 초안은 데이터만으로 산출할 수 없어 비어 있습니다 (사람이 판단하세요).",
  };
}
