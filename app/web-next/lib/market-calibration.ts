// market-calibration.ts — S1 성장율 격차 보정 루프의 순수 로직(design
// 2026-09-18-s1-growth-gap-calibration). 외부 참조 해석 순위, 수렴 목표선
// 판정, 재분석 제약 문자열 조립, 제안 수용/기각을 담당한다. 판정·수용은
// 사람의 행위이며 이 파일은 계산과 저장만 한다(경계 #2).
import type { getDb } from "../../../db/client.ts";

type Db = ReturnType<typeof getDb>;
import { appendAudit } from "../../../db/lib/access-control.ts";
import { CONVERGENCE_GOAL_PCT } from "./market-reference-staleness.ts";

/** 수렴 목표선 — 상수 본체는 클라이언트에서도 쓰는
 * market-reference-staleness.ts에 있다(design
 * 2026-11-13-calibration-loop-convergence §3.1: 이 파일은 appendAudit 경유로
 * db 그래프를 끌어와 클라이언트 번들에 들어갈 수 없다). */
export { CONVERGENCE_GOAL_PCT };

/** 앵커 인용 일치 임계값 (design 2026-11-06-s1-quantitative-web-grounding,
 * amendment 2026-11-12) — 외부 참조 규모가 우리 기준선 외삽치(참조 target_year
 * 기준)와 이 상대 격차(%) 안에 들어오면 참조를 앵커 인용으로 기록한다.
 * 수렴 목표선(15%)과는 다른 값으로 유지한다(design 2026-11-13 §6): 인용은
 * ±20% 규모 일치의 출처 기록이고 목표선은 다음 행동 신호다. 트리거가 15%로
 * 내려온 뒤로는 15~20% 구간에서 인용과 루프가 함께 발동될 수 있으나 서로
 * 충돌하지 않는다(인용=provenance, 루프=다음 행동). */
export const ANCHOR_CITATION_TOLERANCE_PCT = 20;

/** 드라이버 제외 제안의 격차 악화 판정 밴드(%p) — 새 격차가 이전 격차보다 이
 *  밴드를 초과해 악화되었을 때만 leave-one-out 제외 검토를 제안한다. 근거:
 *  동일 입력 재분석에서 관측된 스윕 격차 자체 흔들림이 10.6→10.3(≈0.3pp) 수준
 *  이므로, 그 소음 대역 이내의 악화는 제외 근거로 삼지 않는다(amendment
 *  2026-11-13b). 제안은 어디까지나 제안이다 — 실제 제외는 사람의 기각 확정으로
 *  만 적용된다(경계 #2). */
export const EXCLUSION_NOISE_BAND_PCT = 3.0;

/** 제외 제안 행의 proposed_by 마커 — industry_driver_calibration 테이블을
 *  드라이버 귀인 제안과 공유하므로(스키마 변경 없는 최소 표현), 이 문자열로만
 *  두 행 종류를 구별한다. GET 라우트가 is_exclusion 불리언으로 번역해 UI에
 *  내려보내고, UI는 이 값을 직접 모른다(서버 전용). */
export const EXCLUSION_PROPOSAL_BY = "market-sizing-pipeline:exclusion";

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
  /** 참조 폐기 시각 (migration 0191, amendment 2026-11-12c) — NULL이면 유효. */
  superseded_at: string | null;
  /** 폐기 시 후속 참조 id (평문 폐기는 NULL — 행은 지워지지 않는다). */
  superseded_by: string | null;
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

/** 수렴 판정 — 격차가 산출되고 목표선 이상이면 미수렴(보정 루프 가동: 드라이버
 * 제안·미수렴 배지·재분석 CTA). 목표선 미만이면 수렴으로 루프를 끝낸다(사용자
 * 결정 2026-11-13: 트리거 = 미수렴, 한 격차 하나의 선). */
export function isCalibrationTriggered(ourCagrPct: number, externalCagrPct: number): boolean {
  const gap = relativeCagrGapPct(ourCagrPct, externalCagrPct);
  return gap !== null && gap >= CONVERGENCE_GOAL_PCT;
}

/** 최신 외부 참조 — version_no 내림차순 1건. 폐기된 행은 제외한다
 * (amendment 2026-11-12c: 폐기는 다음 재분석 기준선만 바꾸고, 완료된 분석은
 * 당시 참조를 유지한다). 없으면 null. */
export function resolveExternalReference(db: Db, industryId: string): ExternalReferenceRow | null {
  return (
    (db
      .query(
        "SELECT * FROM market_external_reference WHERE industry_id = ? AND superseded_at IS NULL ORDER BY version_no DESC, created_at DESC LIMIT 1",
      )
      .get(industryId) as ExternalReferenceRow | undefined) ?? null
  );
}

/** 폐기 여부와 무관한 최신 참조 행 (design 2026-11-13 §3.3b) — 표시 버전이
 * 폐기된 참조를 인용하는지 판정하는 UI용. active 참조가 없어도 마지막 행을
 * 돌려주므로, GET이 { reference, latest }로 함께 실어 보낸다. */
export function latestExternalReferenceRow(db: Db, industryId: string): ExternalReferenceRow | null {
  return (
    (db
      .query(
        "SELECT * FROM market_external_reference WHERE industry_id = ? ORDER BY version_no DESC, created_at DESC LIMIT 1",
      )
      .get(industryId) as ExternalReferenceRow | undefined) ?? null
  );
}

/** 참조 폐기 (amendment 2026-11-12c) — 사람이 기록 참조를 은퇴시킨다. 행은
 * 지워지지 않는다(추가 전용 보존): superseded_at만 남기고 superseded_by는
 * NULL(평문 폐기 — 후속 참조 없음). 완료된 분석은 당시 참조를 그대로 유지하고,
 * 다음 재분석부터 웹 검색·LLM 선험 폴백이 다시 동작한다.
 *
 * 계약: 행이 없거나 industry_id가 다르면 null(루트에서 404 처리). 이미 폐기된
 * 행에 대한 재호출은 **멱등 no-op**이다 — 재기록·재감사 없이 본 행을 그대로
 * 돌려준다(409가 아니라 조용한 재확인: DELETE는 멱등 연산이다 — 루트·설계문서
 * 개정판에 문서화됨). 감사는 첫 폐기에만 남는다. */
export function supersedeExternalReference(
  db: Db,
  industryId: string,
  id: string,
  actor: string,
): ExternalReferenceRow | null {
  const row = db.query("SELECT * FROM market_external_reference WHERE id = ?").get(id) as
    | ExternalReferenceRow
    | undefined;
  if (!row || row.industry_id !== industryId) return null;
  if (row.superseded_at !== null) return row;
  const now = new Date().toISOString();
  db.run("UPDATE market_external_reference SET superseded_at = ?, superseded_by = NULL WHERE id = ?", [now, id]);
  appendAudit(db, { actor, action: "market_external_reference.supersede", target: industryId, now });
  return db.query("SELECT * FROM market_external_reference WHERE id = ?").get(id) as ExternalReferenceRow;
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
    [
      id,
      input.industry_id,
      versionNo,
      input.source_label,
      input.source_url ?? null,
      input.target_year,
      input.external_cagr_pct,
      input.external_size_b ?? null,
      input.captured_from,
      input.created_by,
      now,
    ],
  );
  if (input.captured_from === "user") {
    appendAudit(db, {
      actor: input.created_by,
      action: "market_external_reference.set",
      target: input.industry_id,
      now,
    });
  }
  return resolveExternalReference(db, input.industry_id)!;
}

/** 수용된 보정 드라이버 — 사람이 수용(status='accepted')한 행. 사람이 제외를
 *  확정한 드라이버(제외 제안 행이 status='dismissed'로 기각 확정된 것,
 *  amendment 2026-11-13b)는 이 목록에서 뺀다 — 파이프라인은 절대 스스로 제외
 *  하지 않고(경계 #2), 확정된 사람의 결정만 다음 재분석 제약·스윕에서
 *  반영하지 않는다. 일반 귀인 제안의 기각(proposed_by 마커 없음)은 수용 행에
 *  영향을 주지 않는다. */
export function acceptedCalibrationDrivers(db: Db, industryId: string): CalibrationDriverRow[] {
  return db
    .query(
      `SELECT * FROM industry_driver_calibration
       WHERE industry_id = ? AND status = 'accepted'
         AND driver NOT IN (
           SELECT driver FROM industry_driver_calibration
           WHERE industry_id = ? AND proposed_by = ? AND status = 'dismissed' AND decided_by IS NOT NULL
         )
       ORDER BY decided_at DESC`,
    )
    .all(industryId, industryId, EXCLUSION_PROPOSAL_BY) as CalibrationDriverRow[];
}

/** 드라이버 제외 제안 삽입 (amendment 2026-11-13b) — 파이프라인이 재분석 종료
 *  시점에 격차 악화 + leave-one-out 근거를 이유로 삽입한다. 교체 주기는 드라이버
 *  귀인 제안과 같다: 새 제안 삽입 전 이 산업의 미결(status='proposed') 제외 제안
 *  행을 지운다 — 패널에는 항상 최신 재분석의 근거만 남는다. 감사는 삽입이
 *  아니라 사람의 decide에서 기록된다(귀인 제안과 동일). */
export function insertExclusionProposal(
  db: Db,
  input: {
    industryId: string;
    versionId: string;
    driver: string;
    direction: "upside" | "downside";
    impact_pct: number;
    rationale: string;
  },
): CalibrationDriverRow {
  db.run("DELETE FROM industry_driver_calibration WHERE industry_id = ? AND status = 'proposed' AND proposed_by = ?", [
    input.industryId,
    EXCLUSION_PROPOSAL_BY,
  ]);
  db.run(
    `INSERT INTO industry_driver_calibration (id, industry_id, version_id, driver, direction, impact_pct, rationale, status, proposed_by, created_at)
     VALUES (?,?,?,?,?,?,?,'proposed',?,?)`,
    [
      `idc-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      input.industryId,
      input.versionId,
      input.driver,
      input.direction,
      input.impact_pct,
      input.rationale,
      EXCLUSION_PROPOSAL_BY,
      new Date().toISOString(),
    ],
  );
  return db
    .query(
      "SELECT * FROM industry_driver_calibration WHERE industry_id = ? AND proposed_by = ? AND status = 'proposed' ORDER BY created_at DESC LIMIT 1",
    )
    .get(input.industryId, EXCLUSION_PROPOSAL_BY) as CalibrationDriverRow;
}

/** 몬테카를로 스윕 주입 블록의 입력 (amendment 2026-11-13a) — 파이프라인이
 *  실행한 결정론 스윕의 요약. 소프트 제약일 뿐이며 셀 값을 바꾸지 않는다. */
export interface CalibrationSweepInject {
  feasibleRatio: number; // 0..1
  goalPct: number;
  p50GapPct: number;
  p90GapPct: number;
  sampleCount: number;
  /** 기여 상위 드라이버 (p50 내림차순 상위 3개). */
  topDrivers: Array<{ driver: string; p50: number }>;
}

/** 재분석 프롬프트 제약 문자열 — 외부 참조·이전 격차·수용된 보정 드라이버가
 *  모일 때만 문장을 돌려준다(빈 문자열 = 주입할 것 없음). sweepView가 있으면
 *  (amendment 2026-11-13a) 몬테카를로 스윕 블록을 덧붙인다 — 프롬프트 수준의
 *  소프트 제약이며 매트릭스 셀을 결정론적으로 수정하지 않는다(경계 #2). */
export function buildCalibrationConstraints(input: {
  industry: string;
  externalCagrPct: number | null;
  previousGapPct: number | null;
  acceptedDrivers: Array<{ driver: string; direction: string; impact_pct: number; rationale: string }>;
  sweepView?: CalibrationSweepInject | null;
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
  if (input.sweepView) {
    const s = input.sweepView;
    parts.push(
      `최신 몬테카를로 스윕 (seed 고정, ${s.sampleCount}표본): 수용 드라이버 조합의 ${(s.feasibleRatio * 100).toFixed(1)}%가 ${s.goalPct}%선 이내 수렴 가능 — 격차 P50 ${s.p50GapPct}% / P90 ${s.p90GapPct}%`,
    );
    if (s.topDrivers.length > 0) {
      parts.push(
        `상위 기여 드라이버: ${s.topDrivers.map((d) => `${d.driver} 기여 P50 ±${d.p50.toFixed(1)}%p`).join(", ")}`,
      );
    }
    parts.push("이 조합의 상한 기여를 셀별 CAGR 산출에 우선 반영하고, 잔여 격차의 근거를 제시하세요");
  }
  if (parts.length === 0) return "";
  return [
    "",
    "[보정 제약 — v2 루프]",
    ...parts.map((p) => `- ${p}`),
    "- 위 제약을 반영해 추정하고, 참조치와 여전히 격차가 난다면 그 잔여 격차의 근거를 함께 제시하세요.",
  ].join("\n");
}

/** 제안 수용/기각 — 사람의 결정을 기록한다. decided_by는 항상 사용자다.
 *  제외 제안(amendment 2026-11-13b, proposed_by 마커 행)은 기각(dismiss)만
 *  허용된다 — 기각 확정이 곧 "그 드라이버를 수용 목록에서 뺀다"는 사람의
 *  결정이고, 수용(accept)으로 마커 행을 수용 목록에 넣는 것은 행 종류의
 *  의미를 뒤집으므로 금지한다(경계 #2). */
export function decideCalibrationDriver(
  db: Db,
  rowId: string,
  action: "accept" | "dismiss",
  userId: string,
): CalibrationDriverRow | null {
  const row = db.query("SELECT * FROM industry_driver_calibration WHERE id = ?").get(rowId) as
    | CalibrationDriverRow
    | undefined;
  if (!row) return null;
  if (action === "accept" && row.proposed_by === EXCLUSION_PROPOSAL_BY) {
    throw new Error("exclusion proposals are dismiss-only — accepting one is a contract violation (경계 #2)");
  }
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

/** 유효 CAGR 해석기 — 최근 완료 버전의 바텀업 CAGR을 그대로 돌려준다. 결정론
 * 스케일링 에스컬레이션(×0.85)은 design 2026-11-13-calibration-loop-
 * convergence §3.2에서 완전히 제거되었다: 에스컬레이션 결정은 이제 resolver에
 * 영향을 주지 않으며 calibration_escalation은 읽기 전용 이력으로만 남는다.
 * payload에 수치가 없으면 null — 절대 날조하지 않는다. 모든 소비자는 source를
 * 표기해야 한다(무표기 치환 금지). */
export interface EffectiveCagr {
  cagrPct: number;
  source: "bottom_up";
}

export function resolveEffectiveCagr(db: Db, industryId: string): EffectiveCagr | null {
  const version = db
    .query(
      `SELECT v.payload FROM market_sizing_version v
       JOIN market_sizing_analysis a ON a.id = v.analysis_id
       WHERE a.industry_id = ? AND a.status = 'completed'
       ORDER BY v.version_no DESC LIMIT 1`,
    )
    .get(industryId) as { payload: string } | undefined;
  if (!version) return null;
  let bottomUp: number | null = null;
  try {
    const payload = JSON.parse(version.payload) as {
      matrix?: { calibration?: { ourCagrPct?: number | null }; consistency?: { bottomUpCagr?: number | null } };
    };
    const cal = payload?.matrix?.calibration;
    bottomUp =
      typeof cal?.ourCagrPct === "number"
        ? cal.ourCagrPct
        : typeof payload?.matrix?.consistency?.bottomUpCagr === "number"
          ? payload.matrix.consistency.bottomUpCagr
          : null;
  } catch {
    bottomUp = null;
  }
  return bottomUp !== null ? { cagrPct: bottomUp, source: "bottom_up" } : null;
}

// ── 에스컬레이션 이력 (읽기 전용) — 결정론 스케일링 에스컬레이션은 제거되었다
// (design 2026-11-13 §3.2)만 calibration_escalation 테이블과 기록 행은 보존된다
// (파괴 이행 없음, ADR-0012 계열). 이 조회는 보정 GET의 escalation 필드와
// 패널의 읽기 전용 이력 카드를 위해만 남는다. 쓰기 경로는 존재하지 않는다.
export interface CalibrationEscalationRow {
  id: string;
  industry_id: string;
  version_id: string;
  method: string;
  base_our_cagr_pct: number;
  external_cagr_pct: number;
  scaled_cagr_pct: number;
  residual_gap_pct: number;
  rationale: string;
  decided_by: string;
  created_at: string;
}

export function latestCalibrationEscalation(db: Db, industryId: string): CalibrationEscalationRow | null {
  return (
    (db
      .query("SELECT * FROM calibration_escalation WHERE industry_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(industryId) as CalibrationEscalationRow | undefined) ?? null
  );
}
