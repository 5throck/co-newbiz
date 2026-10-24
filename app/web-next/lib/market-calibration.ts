// market-calibration.ts — S1 성장율 격차 보정 루프의 순수 로직(design
// 2026-09-18-s1-growth-gap-calibration). 외부 참조 해석 순위, 20% 트리거
// 판정, 재분석 제약 문자열 조립, 제안 수용/기각을 담당한다. 판정·수용은
// 사람의 행위이며 이 파일은 계산과 저장만 한다(경계 #2).
import { getDb } from "../../../db/client.ts";

type Db = ReturnType<typeof getDb>;
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ulid } from "../../../db/lib/ulid.ts";

/** 보정 트리거 임계값 — 우리 CAGR과 외부 참조 CAGR의 상대 격차(%, 소수 아님). */
export const CALIBRATION_TRIGGER_PCT = 20;

export interface ExternalReferenceRow {
  id: string;
  industry_id: string;
  version_no: number;
  source_label: string;
  source_url: string | null;
  target_year: number;
  external_cagr_pct: number;
  external_size_b: number | null;
  captured_from: "user" | "web_research" | "llm_prior";
  created_by: string;
  created_at: string;
}

export interface CalibrationDriverRow {
  id: string;
  industry_id: string;
  version_id: string;
  driver: string;
  direction: "upside" | "downside";
  impact_pct: number;
  rationale: string;
  status: "proposed" | "accepted" | "dismissed";
  proposed_by: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

/** 상대 격차(%) — |our − external| / external × 100. external ≤ 0이면 null
 * (판정 불가 — 트리거 금지). */
export function relativeCagrGapPct(ourCagrPct: number, externalCagrPct: number): number | null {
  if (!(externalCagrPct > 0)) return null;
  return Math.round((Math.abs(ourCagrPct - externalCagrPct) / externalCagrPct) * 1000) / 10;
}

/** 트리거 판정 — 격차가 산출되고 임계값 이상이면 보정 루프를 태운다. */
export function isCalibrationTriggered(ourCagrPct: number, externalCagrPct: number): boolean {
  const gap = relativeCagrGapPct(ourCagrPct, externalCagrPct);
  return gap !== null && gap >= CALIBRATION_TRIGGER_PCT;
}

/** 최신 외부 참조 — version_no 내림차순 1건. 없으면 null. */
export function resolveExternalReference(db: Db, industryId: string): ExternalReferenceRow | null {
  return (
    (db
      .query(
        "SELECT * FROM market_external_reference WHERE industry_id = ? ORDER BY version_no DESC, created_at DESC LIMIT 1",
      )
      .get(industryId) as ExternalReferenceRow | undefined) ?? null
  );
}

export function appendExternalReference(
  db: Db,
  input: {
    industry_id: string;
    source_label: string;
    source_url?: string | null;
    target_year: number;
    external_cagr_pct: number;
    external_size_b?: number | null;
    captured_from: "user" | "web_research" | "llm_prior";
    created_by: string;
  },
): ExternalReferenceRow {
  const latest = resolveExternalReference(db, input.industry_id);
  const versionNo = (latest?.version_no ?? 0) + 1;
  const id = `mer-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO market_external_reference (id, industry_id, version_no, source_label, source_url, target_year, external_cagr_pct, external_size_b, captured_from, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.industry_id, versionNo, input.source_label, input.source_url ?? null, input.target_year, input.external_cagr_pct, input.external_size_b ?? null, input.captured_from, input.created_by, now],
  );
  if (input.captured_from === "user") {
    appendAudit(db, { actor: input.created_by, action: "market_external_reference.set", target: input.industry_id, now });
  }
  return resolveExternalReference(db, input.industry_id)!;
}

export function acceptedCalibrationDrivers(db: Db, industryId: string): CalibrationDriverRow[] {
  return db
    .query(
      "SELECT * FROM industry_driver_calibration WHERE industry_id = ? AND status = 'accepted' ORDER BY decided_at DESC",
    )
    .all(industryId) as CalibrationDriverRow[];
}

/** 재분석 프롬프트 제약 문자열 — 외부 참조·이전 격차·수용된 보정 드라이버가
 *  모일 때만 문장을 돌려준다(빈 문자열 = 주입할 것 없음). */
export function buildCalibrationConstraints(input: {
  industry: string;
  externalCagrPct: number | null;
  previousGapPct: number | null;
  acceptedDrivers: Array<{ driver: string; direction: string; impact_pct: number; rationale: string }>;
}): string {
  const parts: string[] = [];
  if (input.externalCagrPct !== null && input.externalCagrPct > 0) {
    parts.push(`외부 참조 성장률: 연평균 ${input.externalCagrPct.toFixed(1)}% (사람이 출처를 확인한 참조치)`);
  }
  if (input.previousGapPct !== null) {
    parts.push(`이전 버전의 외부 참조 대비 격차: ${input.previousGapPct}%`);
  }
  if (input.acceptedDrivers.length > 0) {
    const drivers = input.acceptedDrivers
      .map((d) => `${d.driver}(${d.direction === "upside" ? "상승" : "하강"} 요인, CAGR ±${d.impact_pct.toFixed(1)}%p)`)
      .join(", ");
    parts.push(`사람이 수용한 보정 드라이버: ${drivers}`);
  }
  if (parts.length === 0) return "";
  return [
    "",
    "[보정 제약 — v2 루프]",
    ...parts.map((p) => `- ${p}`),
    "- 위 제약을 반영해 추정하고, 참조치와 여전히 격차가 난다면 그 잔여 격차의 근거를 함께 제시하세요.",
  ].join("\n");
}

/** 제안 수용/기각 — 사람의 결정을 기록한다. decided_by는 항상 사용자다. */
export function decideCalibrationDriver(
  db: Db,
  rowId: string,
  action: "accept" | "dismiss",
  userId: string,
): CalibrationDriverRow | null {
  const row = db.query("SELECT * FROM industry_driver_calibration WHERE id = ?").get(rowId) as CalibrationDriverRow | undefined;
  if (!row) return null;
  const now = new Date().toISOString();
  db.run("UPDATE industry_driver_calibration SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?", [
    action === "accept" ? "accepted" : "dismissed",
    userId,
    now,
    rowId,
  ]);
  appendAudit(db, { actor: userId, action: `market_calibration.${action}`, target: row.industry_id, now });
  return db.query("SELECT * FROM industry_driver_calibration WHERE id = ?").get(rowId) as CalibrationDriverRow;
}

// ── 결정론 CAGR 스케일링 에스컬레이션 (design 2026-09-20-calibration-escalation)
// LLM 재분석이 수렴선에 도달하지 못하는 산업에 대해, 사람이 결정론 산술로
// 조정 CAGR을 채택한다: 외부 참조 × (1 − 수렴선) — 외부 참조를 보수성
// 헤어컷(잔여 격차 = 수렴선)과 함께 채택하는 것과 같다. 순수 함수 — 금액을
// 지어내지 않고, 결정은 사람이 기록한다(경계 #2).
export const CONVERGENCE_TARGET_PCT = 15;

export interface DeterministicScaling {
  scaledCagrPct: number;
  residualGapPct: number;
}

export function computeDeterministicScaling(externalCagrPct: number): DeterministicScaling {
  if (!Number.isFinite(externalCagrPct) || externalCagrPct <= 0) {
    throw new Error("externalCagrPct must be a positive finite number.");
  }
  const scaled = Math.round(externalCagrPct * (1 - CONVERGENCE_TARGET_PCT / 100) * 10) / 10;
  return { scaledCagrPct: scaled, residualGapPct: CONVERGENCE_TARGET_PCT };
}

export interface CalibrationEscalationRow {
  id: string; industry_id: string; version_id: string; method: string;
  base_our_cagr_pct: number; external_cagr_pct: number; scaled_cagr_pct: number;
  residual_gap_pct: number; rationale: string; decided_by: string; created_at: string;
}

export function latestCalibrationEscalation(db: Db, industryId: string): CalibrationEscalationRow | null {
  return (db
    .query("SELECT * FROM calibration_escalation WHERE industry_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(industryId) as CalibrationEscalationRow | undefined) ?? null;
}

/** 최근 완료 버전의 calibration 블록을 읽어 에스컬레이션을 기록한다. 격차가
 * 이미 수렴선 이하면 409 충돌로 거부한다(에스컬레이션할 것이 없다). */
export function applyCalibrationEscalation(
  db: Db,
  industryId: string,
  decidedBy: string,
  rationale: string,
  now: string,
): { escalation: CalibrationEscalationRow } {
  const version = db
    .query(
      `SELECT v.id, v.payload FROM market_sizing_version v
       JOIN market_sizing_analysis a ON a.id = v.analysis_id
       WHERE a.industry_id = ? AND a.status = 'completed'
       ORDER BY v.version_no DESC LIMIT 1`,
    )
    .get(industryId) as { id: string; payload: string } | undefined;
  if (!version) throw new EscalationError("no_completed_version", "No completed market-analysis version.");
  let calib: { gapPct?: number | null; ourCagrPct?: number | null; externalCagrPct?: number | null } | undefined;
  try {
    calib = (JSON.parse(version.payload) as { matrix?: { calibration?: typeof calib } }).matrix?.calibration;
  } catch {
    calib = undefined;
  }
  const our = calib?.ourCagrPct;
  const external = calib?.externalCagrPct;
  const gap = calib?.gapPct;
  if (typeof our !== "number" || typeof external !== "number" || typeof gap !== "number") {
    throw new EscalationError("no_calibration_block", "The latest version has no calibration block — re-analysis is required first.");
  }
  if (gap <= CONVERGENCE_TARGET_PCT) {
    throw new EscalationError("already_converged", `The gap ${gap}% is already within the convergence target (${CONVERGENCE_TARGET_PCT}%).`);
  }
  const { scaledCagrPct, residualGapPct } = computeDeterministicScaling(external);
  const id = ulid();
  db.run(
    `INSERT INTO calibration_escalation
     (id, industry_id, version_id, method, base_our_cagr_pct, external_cagr_pct, scaled_cagr_pct, residual_gap_pct, rationale, decided_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, industryId, version.id, "deterministic_scaling", our, external, scaledCagrPct, residualGapPct, rationale, decidedBy, now],
  );
  appendAudit(db, { actor: decidedBy, action: "market_calibration.escalate", target: industryId, now });
  return { escalation: db.query("SELECT * FROM calibration_escalation WHERE id = ?").get(id) as CalibrationEscalationRow };
}

/** 유효 CAGR 해석기 (design 2026-09-20-escalation-downstream §3.1) — 최근 완료
 * 버전의 바텀업 CAGR을 기본으로 하되, 사람이 기록한 에스컬레이션 결정이
 * 재분석보다 최신이면 조정치를 반환한다(재분석이 결정을 덮지 않는다). 모든
 * 소비자는 source를 표기해야 한다(무표기 치환 금지). */
export interface EffectiveCagr {
  cagrPct: number;
  source: "bottom_up" | "escalated";
  escalationId?: string;
  baseCagrPct?: number;
}

export function resolveEffectiveCagr(db: Db, industryId: string): EffectiveCagr | null {
  const version = db
    .query(
      `SELECT v.created_at, v.payload FROM market_sizing_version v
       JOIN market_sizing_analysis a ON a.id = v.analysis_id
       WHERE a.industry_id = ? AND a.status = 'completed'
       ORDER BY v.version_no DESC LIMIT 1`,
    )
    .get(industryId) as { created_at: string; payload: string } | undefined;
  if (!version) return null;
  let bottomUp: number | null = null;
  try {
    const payload = JSON.parse(version.payload) as { matrix?: { calibration?: { ourCagrPct?: number | null }; consistency?: { bottomUpCagr?: number | null } } };
    const cal = payload?.matrix?.calibration;
    bottomUp = typeof cal?.ourCagrPct === "number" ? cal.ourCagrPct : typeof payload?.matrix?.consistency?.bottomUpCagr === "number" ? payload.matrix.consistency.bottomUpCagr : null;
  } catch {
    bottomUp = null;
  }
  const esc = latestCalibrationEscalation(db, industryId);
  if (esc && esc.created_at >= version.created_at) {
    return { cagrPct: esc.scaled_cagr_pct, source: "escalated", escalationId: esc.id, baseCagrPct: esc.base_our_cagr_pct };
  }
  if (bottomUp !== null) return { cagrPct: bottomUp, source: "bottom_up" };
  if (esc) return { cagrPct: esc.scaled_cagr_pct, source: "escalated", escalationId: esc.id, baseCagrPct: esc.base_our_cagr_pct };
  return null;
}

export class EscalationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
