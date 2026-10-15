// S7 재무·기술 평가 레이어 (ADR-0139) — chk-target-screening(t-01~t-09)과
// 병행하는 오퍼튜니티별 평가 카탈로그. 기술 평가는 S3 역량 갭 레지스터
// (ADR-0136)에서 항목별로 시딩하고, 재무 평가는 빌트인 4항목 + 커스텀.
// 판정은 항상 사람이 내린다 — 재무 빌트인 항목은 DART 기반 결정론적 "초안"
// (ADR-0140, brownfield-financial-rubric.ts)을 사람이 확인·수정해 확정한다.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { parseGapRegister } from "./capability-gap.ts";
import { isFinancialDataRef, parseRubric, sanitizeRubricInput, type FinancialDataRef } from "./brownfield-financial-rubric.ts";

export type EvalCategory = "financial" | "technical";
export type EvalSource = "builtin" | "seeded" | "custom";
// pass=충족, partial=부분충족, fail=미충족 — 100점 점수 계산에 들어간다.
// na/waived는 "예외"로, 점수 계산(분자·분모 모두)에서 제외한다(사용자 요청).
export type EvalStatus = "pending" | "pass" | "partial" | "fail" | "na" | "waived";

export interface EvalCriterion {
  id: string;
  opportunity_id: string;
  category: EvalCategory;
  source: EvalSource;
  label: string;
  description: string | null;
  data_ref: string | null;
  seed_ref: string | null;
  is_mandatory: 0 | 1;
  is_deletable: 0 | 1;
  /** 상대 가중치(기본 10) — 카테고리 내 100점 가중 점수 계산에 쓰인다. */
  weight: number;
  /** 재무 빌트인 항목의 판정 루브릭 임계값(ADR-0140) — NULL이면 코드 기본값. */
  rubric_json: string | null;
  /** ADR-0171: set when the seeded criterion's S3 row was removed (marker, never deleted). */
  retired_at?: string | null;
  retired_reason?: string | null;
  created_by: string;
  created_at: string;
}

export interface EvalStateRow {
  id: string;
  brownfield_target_id: string;
  criterion_id: string;
  status: EvalStatus;
  note: string | null;
  evidence_ref: string | null;
  assessed_by: string;
  assessed_at: string;
}

// 재무 평가 고정 항목 — 과거 5개년 매출/영업이익/부채 규모·추이를 기준으로
// 한다(사용자 요청). 비율 지표(영업이익률·순이익률·부채비율)는 별도 항목이
// 아니라 각 항목의 참고 패널에서 함께 보여준다 — 매출은 느는데 마진이
// 무너지는 패턴을 놓치지 않기 위함. 영업부문(사업부문별 실적)은 DART에
// 세그먼트 데이터를 주는 엔드포인트가 없어 v1에서 명시적으로 제외한다
// (수기 노트로 남기고 싶으면 커스텀 항목으로 추가).
const BUILTIN_FINANCIAL: Array<{ label: string; description: string; data_ref: string }> = [
  {
    label: "매출액 규모·5개년 추이",
    description: "5개년 매출액과 전년대비 증감율(참고) — DART 동기화 값이 있으면 표시, 판정은 사람이 내린다.",
    data_ref: "revenue_5y",
  },
  {
    label: "영업이익 규모·5개년 추이(흑자 지속 여부 포함)",
    description: "5개년 영업이익 절대액과 영업이익률·순이익률(참고) — 매출 성장과 마진 추세를 함께 확인한다.",
    data_ref: "operating_profit_5y",
  },
  {
    // 당기순이익 항목(ADR-0140) — 영업이익에 잡히지 않는 금융비용·일회성
    // 손익까지 반영한 최종 수익성. facts는 이미 입수되고 있으므로 항목만 추가.
    label: "당기순이익 규모·5개년 추이(순이익률 포함)",
    description: "5개년 당기순이익과 순이익률(참고) — 영업외 손익·금융비용 부담을 포함한 최종 수익성을 확인한다.",
    data_ref: "net_income_5y",
  },
  {
    label: "부채 규모·5개년 추이(부채비율 포함)",
    description: "5개년 부채총계와 부채비율(참고). 영업부문(사업부문별 실적)은 DART 세그먼트 데이터 미지원으로 v1 범위 밖 — 필요 시 커스텀 항목으로 수기 기록.",
    data_ref: "debt_5y",
  },
];

function now(): string {
  return new Date().toISOString();
}

/** 오퍼튜니티의 평가 카탈로그를 반환한다. 최초 호출 시 재무 빌트인·기술
 * 시딩을 lazy하게 채운다(둘 다 이미 있으면 아무것도 하지 않는다). 재무
 * 빌트인은 data_ref 단위로 보강한다 — 빌트인 항목이 추가돼도(예: 당기순이익,
 * ADR-0140) 이미 카탈로그가 있는 기존 오퍼튜니티에 새 항목만 시딩된다. */
export function listOrSeedCriteria(opportunityId: string, seededBy: string, db: Database = getDb()): EvalCriterion[] {
  const existing = db
    .query("SELECT * FROM brownfield_eval_criterion WHERE opportunity_id = ? AND deleted_at IS NULL AND retired_at IS NULL ORDER BY category, created_at")
    .all(opportunityId) as unknown as EvalCriterion[];

  const existingFinancialRefs = new Set(existing.filter((c) => c.category === "financial").map((c) => c.data_ref));
  const inserted: EvalCriterion[] = [];

  for (const item of BUILTIN_FINANCIAL) {
    if (existingFinancialRefs.has(item.data_ref)) continue;
    inserted.push(insertCriterion(db, {
      opportunity_id: opportunityId, category: "financial", source: "builtin",
      label: item.label, description: item.description, data_ref: item.data_ref, seed_ref: null,
      is_mandatory: 0, is_deletable: 0, weight: DEFAULT_WEIGHT, rubric_json: null, created_by: seededBy,
    }));
  }

  // Retired seeded criteria count too: a first seed must never re-run once criteria existed (ADR-0171 D6).
  const hasTechnicalSeeded = !!db
    .query("SELECT 1 AS x FROM brownfield_eval_criterion WHERE opportunity_id = ? AND category = 'technical' AND source = 'seeded' LIMIT 1")
    .get(opportunityId);
  if (!hasTechnicalSeeded) {
    const opp = db.query("SELECT capability_gap_json FROM opportunity WHERE id = ?").get(opportunityId) as { capability_gap_json: string | null } | undefined;
    const register = parseGapRegister(opp?.capability_gap_json ?? null);
    for (const gap of register.rows) {
      inserted.push(insertCriterion(db, {
        opportunity_id: opportunityId, category: "technical", source: "seeded",
        label: gap.capability,
        description: `S3 필요 역량 평가 기준. ${gap.requiredNote || ""}`.trim(),
        data_ref: null, seed_ref: gap.id,
        is_mandatory: 1, is_deletable: 0, weight: DEFAULT_WEIGHT, rubric_json: null, created_by: seededBy,
      }));
    }
    // 레지스터가 비어 있으면 시딩하지 않는다 — 내용을 지어내지 않는다
    // (호출부가 "S3에서 먼저 정의하세요" 안내를 별도로 보여준다).
  }

  return inserted.length > 0 ? [...existing, ...inserted] : existing;
}

const DEFAULT_WEIGHT = 10;

function insertCriterion(db: Database, opts: Omit<EvalCriterion, "id" | "created_at">): EvalCriterion {
  const id = ulid();
  const at = now();
  db.run(
    `INSERT INTO brownfield_eval_criterion (id, opportunity_id, category, source, label, description, data_ref, seed_ref, is_mandatory, is_deletable, weight, rubric_json, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, opts.opportunity_id, opts.category, opts.source, opts.label, opts.description, opts.data_ref, opts.seed_ref, opts.is_mandatory, opts.is_deletable, opts.weight, opts.rubric_json, opts.created_by, at],
  );
  return { ...opts, id, created_at: at };
}

export function addCustomCriterion(
  opportunityId: string, category: EvalCategory, label: string, description: string | null, createdBy: string, weight: number = DEFAULT_WEIGHT,
): EvalCriterion {
  return insertCriterion(getDb(), {
    opportunity_id: opportunityId, category, source: "custom",
    label, description, data_ref: null, seed_ref: null, is_mandatory: 0, is_deletable: 1, weight, rubric_json: null, created_by: createdBy,
  });
}

/** 항목 가중치 수정 — builtin/seeded/custom 모두 허용(라벨·판정과 달리
 * 가중치는 상대적 중요도 조정일 뿐이라 시딩 항목도 바꿀 수 있어야 한다). */
export function updateCriterionWeight(criterionId: string, weight: number): { ok: true } | { ok: false; reason: "not_found" | "invalid_weight" } {
  if (!Number.isFinite(weight) || weight <= 0) return { ok: false, reason: "invalid_weight" };
  const db = getDb();
  const row = db.query("SELECT id FROM brownfield_eval_criterion WHERE id = ? AND deleted_at IS NULL").get(criterionId) as { id: string } | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  db.run("UPDATE brownfield_eval_criterion SET weight = ? WHERE id = ?", [Math.round(weight), criterionId]);
  return { ok: true };
}

export type UpdateRubricResult = { ok: true } | { ok: false; reason: "not_found" | "not_rubric_capable" | "invalid_input" };

/** 재무 빌트인 항목의 판정 루브릭 임계값 수정(ADR-0140) — 부분 PATCH를
 * 허용한다(기존값·기본값에 병합). 대상은 재무 빌트인(자동 초안 대상)뿐이며
 * 커스텀·기술 항목은 거부한다 — 루브릭 모양이 data_ref별로 정해지기 때문. */
export function updateCriterionRubric(criterionId: string, rubricInput: unknown): UpdateRubricResult {
  const db = getDb();
  const row = db
    .query("SELECT id, category, source, data_ref, rubric_json FROM brownfield_eval_criterion WHERE id = ? AND deleted_at IS NULL")
    .get(criterionId) as { id: string; category: EvalCategory; source: EvalSource; data_ref: string | null; rubric_json: string | null } | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.category !== "financial" || row.source !== "builtin" || !isFinancialDataRef(row.data_ref)) {
    return { ok: false, reason: "not_rubric_capable" };
  }
  const dataRef: FinancialDataRef = row.data_ref;
  const patch = sanitizeRubricInput(dataRef, rubricInput);
  if (!patch) return { ok: false, reason: "invalid_input" };
  const merged = { ...parseRubric(dataRef, row.rubric_json), ...patch };
  db.run("UPDATE brownfield_eval_criterion SET rubric_json = ? WHERE id = ?", [JSON.stringify(merged), criterionId]);
  return { ok: true };
}

export type DeleteCriterionResult = { ok: true } | { ok: false; reason: "not_found" | "not_deletable" | "has_assessment" };

export function deleteCriterion(criterionId: string): DeleteCriterionResult {
  const db = getDb();
  const row = db.query("SELECT id, is_deletable FROM brownfield_eval_criterion WHERE id = ? AND deleted_at IS NULL").get(criterionId) as
    | { id: string; is_deletable: 0 | 1 }
    | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.is_deletable) return { ok: false, reason: "not_deletable" };
  const assessed = db
    .query("SELECT COUNT(*) c FROM brownfield_target_eval_state WHERE criterion_id = ? AND status != 'pending'")
    .get(criterionId) as { c: number };
  if (assessed.c > 0) return { ok: false, reason: "has_assessment" };
  db.run("UPDATE brownfield_eval_criterion SET deleted_at = ? WHERE id = ?", [now(), criterionId]);
  return { ok: true };
}

/** 한 후보(target)의 판정 상태 — 카탈로그의 모든 항목에 대해 없으면 pending으로 채운다. */
export function targetEvalStates(opportunityId: string, targetId: string, seededBy: string): Array<EvalCriterion & { state: EvalStateRow | null }> {
  const db = getDb();
  const criteria = listOrSeedCriteria(opportunityId, seededBy, db);
  const states = db
    .query("SELECT * FROM brownfield_target_eval_state WHERE brownfield_target_id = ?")
    .all(targetId) as unknown as EvalStateRow[];
  const byCriterion = new Map(states.map((s) => [s.criterion_id, s]));
  return criteria.map((c) => ({ ...c, state: byCriterion.get(c.id) ?? null }));
}

export interface EvalCategorySummary {
  total: number;
  assessed: number;
  passed: number;
}

/** Long List 후보 비교용 요약 배지 — screeningSummary()와 같은 모양의
 * 순수 카운트 집계. na/waived는 assessed로만 잡고 passed에 넣지 않는다. */
export function summarizeEvalStates(items: Array<{ category: EvalCategory; state: { status: EvalStatus } | null }>): Record<EvalCategory, EvalCategorySummary> {
  const summary: Record<EvalCategory, EvalCategorySummary> = {
    financial: { total: 0, assessed: 0, passed: 0 },
    technical: { total: 0, assessed: 0, passed: 0 },
  };
  for (const item of items) {
    const bucket = summary[item.category];
    bucket.total++;
    const status = item.state?.status ?? "pending";
    if (status !== "pending") bucket.assessed++;
    if (status === "pass") bucket.passed++;
  }
  return summary;
}

export interface EvalCategoryScore {
  /** 0-100 가중 점수. 이 카테고리에서 아직 하나도 판정(충족/부분충족/미충족)되지
   * 않았으면 null. */
  score: number | null;
  /** 점수 계산에 들어간(충족/부분충족/미충족으로 판정된) 항목의 가중치 합. */
  scoredWeight: number;
  /** 예외(해당없음·예외)를 뺀 전체 항목 가중치 합 — scoredWeight와 비교해
   * 판정이 얼마나 남았는지 가늠한다. */
  totalWeight: number;
  /** 예외(해당없음·예외)로 처리되어 점수 계산에서 빠진 항목의 가중치 합. */
  excludedWeight: number;
}

/** S7 재무·기술 평가 — 카테고리(financial/technical)별로 가중 점수를 100점
 * 만점으로 낸다. 충족=1, 부분충족=0.5, 미충족=0으로 환산해 weight로 가중
 * 평균한다. 예외(na/waived)는 분자·분모 모두에서 제외한다(판정 시 예외는
 * 점수에 넣지 않는다는 사용자 요구) — 미판정(pending) 항목도 아직 점수에
 * 넣지 않되, totalWeight에는 잡아 "판정 진행률"을 따로 보여줄 수 있게 한다.
 * 두 카테고리를 하나로 합치지 않는다 — 재무와 기술은 서로 다른 평가 영역이라
 * 각자 100점으로 보여준다(사용자 요구). */
export function computeEvalScore(
  items: Array<{ category: EvalCategory; weight: number; state: { status: EvalStatus } | null }>,
): Record<EvalCategory, EvalCategoryScore> {
  const out: Record<EvalCategory, EvalCategoryScore> = {
    financial: { score: null, scoredWeight: 0, totalWeight: 0, excludedWeight: 0 },
    technical: { score: null, scoredWeight: 0, totalWeight: 0, excludedWeight: 0 },
  };
  const acc: Record<EvalCategory, { num: number; den: number }> = {
    financial: { num: 0, den: 0 },
    technical: { num: 0, den: 0 },
  };
  for (const item of items) {
    const bucket = out[item.category];
    const status = item.state?.status ?? "pending";
    if (status === "na" || status === "waived") {
      bucket.excludedWeight += item.weight;
      continue;
    }
    bucket.totalWeight += item.weight;
    if (status === "pending") continue;
    const value = status === "pass" ? 1 : status === "partial" ? 0.5 : 0; // fail = 0
    acc[item.category].num += item.weight * value;
    acc[item.category].den += item.weight;
    bucket.scoredWeight += item.weight;
  }
  for (const cat of ["financial", "technical"] as const) {
    out[cat].score = acc[cat].den > 0 ? Math.round((acc[cat].num / acc[cat].den) * 100) : null;
  }
  return out;
}

/** Long List 랭킹용 단일 지표 — financial/technical 100점 점수의 평균.
 * 둘 다 있으면 평균, 하나만 있으면 그 값, 둘 다 없으면 null(아직 미판정) —
 * 카테고리 데이터 자체는 합치지 않는다(각자 100점으로 유지, 이 함수는
 * 정렬·랭킹 표시 전용 파생값). */
export function combinedEvalScore(scores: Record<EvalCategory, EvalCategoryScore>): number | null {
  const values = (["financial", "technical"] as const).map((cat) => scores[cat].score).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function upsertEvalState(targetId: string, criterionId: string, opts: { status: EvalStatus; note: string | null; evidence_ref: string | null; assessedBy: string }): EvalStateRow {
  const db = getDb();
  const existing = db.query("SELECT id FROM brownfield_target_eval_state WHERE brownfield_target_id = ? AND criterion_id = ?").get(targetId, criterionId) as { id: string } | undefined;
  const at = now();
  if (existing) {
    db.run(
      "UPDATE brownfield_target_eval_state SET status = ?, note = ?, evidence_ref = ?, assessed_by = ?, assessed_at = ? WHERE id = ?",
      [opts.status, opts.note, opts.evidence_ref, opts.assessedBy, at, existing.id],
    );
    return { id: existing.id, brownfield_target_id: targetId, criterion_id: criterionId, status: opts.status, note: opts.note, evidence_ref: opts.evidence_ref, assessed_by: opts.assessedBy, assessed_at: at };
  }
  const id = ulid();
  db.run(
    `INSERT INTO brownfield_target_eval_state (id, brownfield_target_id, criterion_id, status, note, evidence_ref, assessed_by, assessed_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, targetId, criterionId, opts.status, opts.note, opts.evidence_ref, opts.assessedBy, at],
  );
  return { id, brownfield_target_id: targetId, criterion_id: criterionId, status: opts.status, note: opts.note, evidence_ref: opts.evidence_ref, assessed_by: opts.assessedBy, assessed_at: at };
}

// ── Criteria reconcile (ADR-0171 D6) ─────────────────────────────────────────
// Seeding used to run once, so S3 rows added later never reached S7 and removed rows
// lingered. Reconcile compares the S3 register with the seeded technical criteria:
// missing rows are seeded, removed rows are retired (marker; evaluation records and
// judgements stay), renamed rows get the new label. Weights and verdicts are person-entered
// and are never touched. Detection is read-only; reconcile is an explicit analyst+ action.

export interface ReconcilePlan {
  /** S3 rows without a (non-retired) seeded criterion. */
  missing: Array<{ rowId: string; capability: string }>;
  /** Seeded criteria whose S3 row no longer exists. */
  retire: Array<{ criterionId: string; label: string; seedRef: string; assessedTargets: number }>;
  /** Seeded criteria whose label no longer matches the S3 capability name. */
  relabel: Array<{ criterionId: string; from: string; to: string }>;
  /** Retired criteria whose S3 row exists again. */
  reinstate: Array<{ criterionId: string; label: string }>;
  /** True when nothing needs reconciling. */
  inSync: boolean;
}

export function detectCriteriaReconcile(opportunityId: string, db: Database = getDb()): ReconcilePlan {
  const opp = db.query("SELECT capability_gap_json FROM opportunity WHERE id = ?").get(opportunityId) as { capability_gap_json: string | null } | undefined;
  const rows = parseGapRegister(opp?.capability_gap_json ?? null).rows;
  const seeded = db
    .query("SELECT * FROM brownfield_eval_criterion WHERE opportunity_id = ? AND category = 'technical' AND source = 'seeded' AND deleted_at IS NULL")
    .all(opportunityId) as unknown as EvalCriterion[];
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const bySeed = new Map(seeded.filter((c) => c.seed_ref).map((c) => [c.seed_ref as string, c]));
  const plan: ReconcilePlan = { missing: [], retire: [], relabel: [], reinstate: [], inSync: true };
  for (const r of rows) {
    const c = bySeed.get(r.id);
    if (!c) plan.missing.push({ rowId: r.id, capability: r.capability });
    else if (c.retired_at) plan.reinstate.push({ criterionId: c.id, label: c.label });
    else if (c.label !== r.capability) plan.relabel.push({ criterionId: c.id, from: c.label, to: r.capability });
  }
  for (const c of seeded) {
    if (c.retired_at || !c.seed_ref || rowById.has(c.seed_ref)) continue;
    const assessed = (db.query("SELECT COUNT(*) AS c FROM brownfield_target_eval_state WHERE criterion_id = ? AND status != 'pending'").get(c.id) as { c: number }).c;
    plan.retire.push({ criterionId: c.id, label: c.label, seedRef: c.seed_ref, assessedTargets: assessed });
  }
  plan.inSync = plan.missing.length + plan.retire.length + plan.relabel.length + plan.reinstate.length === 0;
  return plan;
}

export interface ReconcileResult { added: number; retired: number; relabeled: number; reinstated: number }

/** Apply the reconcile plan in one transaction. Idempotent: a second run changes nothing. */
export function reconcileCriteria(opportunityId: string, actor: string, db: Database = getDb(), at: string = now()): ReconcileResult {
  return db.transaction((): ReconcileResult => {
    const opp = db.query("SELECT capability_gap_json FROM opportunity WHERE id = ?").get(opportunityId) as { capability_gap_json: string | null } | undefined;
    const rows = parseGapRegister(opp?.capability_gap_json ?? null).rows;
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const plan = detectCriteriaReconcile(opportunityId, db);
    for (const m of plan.missing) {
      const r = rowById.get(m.rowId)!;
      insertCriterion(db, {
        opportunity_id: opportunityId, category: "technical", source: "seeded",
        label: r.capability, description: `S3 필요 역량 평가 기준. ${r.requiredNote || ""}`.trim(),
        data_ref: null, seed_ref: r.id, is_mandatory: 1, is_deletable: 0, weight: DEFAULT_WEIGHT, rubric_json: null, created_by: actor,
      });
    }
    for (const x of plan.retire) {
      db.run("UPDATE brownfield_eval_criterion SET retired_at = ?, retired_reason = ? WHERE id = ?", [at, "s3_row_removed", x.criterionId]);
    }
    for (const x of plan.relabel) {
      db.run("UPDATE brownfield_eval_criterion SET label = ? WHERE id = ?", [x.to, x.criterionId]);
    }
    for (const x of plan.reinstate) {
      db.run("UPDATE brownfield_eval_criterion SET retired_at = NULL, retired_reason = NULL WHERE id = ?", [x.criterionId]);
    }
    const result: ReconcileResult = { added: plan.missing.length, retired: plan.retire.length, relabeled: plan.relabel.length, reinstated: plan.reinstate.length };
    if (!plan.inSync) {
      appendAudit(db, {
        actor, action: "brownfield_eval_criteria.reconcile", now: at,
        target: `${opportunityId}#criteria-reconcile:surface=S7:added=${result.added},retired=${result.retired},relabeled=${result.relabeled},reinstated=${result.reinstated}`,
      });
    }
    return result;
  })();
}
