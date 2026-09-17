// market-calibration.ts — S1 성장율 격차 보정 루프의 순수 로직(design
// 2026-09-18-s1-growth-gap-calibration). 외부 참조 해석 순위, 20% 트리거
// 판정, 재분석 제약 문자열 조립, 제안 수용/기각을 담당한다. 판정·수용은
// 사람의 행위이며 이 파일은 계산과 저장만 한다(경계 #2).
import { getDb } from "../../../db/client.ts";

type Db = ReturnType<typeof getDb>;
import { appendAudit } from "../../../db/lib/access-control.ts";

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
