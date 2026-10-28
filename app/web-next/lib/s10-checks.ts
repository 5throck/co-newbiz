// @version 1.0.0
/**
 * S10 investment-structure checks beyond "sources = uses" (ADR-0187 phase P3,
 * finding M1; design 2026-10-27-process-ssot-decision-evidence-design 4.1):
 *
 *   (a) total uses reconcile to the S8 adopted investment within a tolerance;
 *   (b) the downside covenant headroom (DSCR) clears a floor;
 *   (c) every funding source carries funding-certainty evidence.
 *
 * Thresholds are the owner-confirmed D2 starting values (ADR-0187, 2026-10-27).
 * They are PROPOSALS owned by risk-officer + quant-methodologist and change
 * only through a recorded owner decision - never by editing a caller. Each is a
 * named constant below with its provenance.
 *
 * Semantics (gate blockers, flow.spec 2.16.0 S10 completionCriteria 2-4):
 *  - (a) blocks when the adopted investment is derivable and uses are outside the
 *    tolerance. When it is NOT derivable (no adopted case, no capex lines, or a
 *    unit that is not KRW_M) there is no reference value, so the check cannot
 *    pass or fail: it never blocks, never passes silently, and names the gap in
 *    `advisories` for a person to reconcile (same stance as
 *    lib/greenfield-execution.ts trancheReconciliation).
 *  - (b) applies only when the project has debt (a debt_instrument row). Debt with
 *    no covenant evidence, no DSCR covenant test, or a minimum projected DSCR below
 *    the floor blocks. The latest covenant simulation of the project is the
 *    downside run (db/lib/snapshot-filler.ts D-M-RISK-5 reads the same one);
 *    simulations carry no scenario tag today, so that is an assumption, reported.
 *  - (c) blocks when any source row lacks evidence_kind or a non-blank
 *    evidence_ref (migration 0162).
 * Grandfathering (ADR-0151 precedent): a project whose earliest policy pin (or
 * creation) predates ADR_0187_P3_PREDICATE_DATE keeps the legacy S10 predicate -
 * a tightening never retroactively un-completes in-flight work.
 *
 * Money is INTEGER-ish KRW millions end to end (ADR-0061); nothing here converts.
 */
import type { Database } from "bun:sqlite";
import { adoptedCaseCapex } from "./greenfield-execution.ts";
import { covenantHeadroom } from "./covenant-headroom.ts";
import { blocker } from "./process-blocker-keys.ts";

/**
 * D2 (owner-confirmed 2026-10-27, ADR-0187): total uses within +/-5% of the S8
 * adopted investment. Owner of the value: risk-officer + quant-methodologist.
 */
export const S10_USES_RECONCILIATION_TOLERANCE = 0.05;

/**
 * D2 (owner-confirmed 2026-10-27, ADR-0187): downside DSCR headroom of at least
 * 1.2x - the minimum projected DSCR across periods must be >= this multiple.
 * Owner of the value: risk-officer + quant-methodologist.
 */
export const S10_MIN_DOWNSIDE_DSCR = 1.2;

/** Predicate date of the M1 tightening (same grandfathering rule as WAVE_F_PREDICATE_DATE). */
export const ADR_0187_P3_PREDICATE_DATE = "2026-10-28";

export interface S10CheckResult {
  blockers: string[];
  missing: string[];
  /** Non-blocking notes a person must read (reconciliation not derivable). */
  advisories: string[];
}

const empty = (): S10CheckResult => ({ blockers: [], missing: [], advisories: [] });
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** (a) uses vs the S8 adopted investment. */
export function s10UsesReconciliation(db: Database, projectId: string): S10CheckResult {
  const out = empty();
  const uses = (db
    .query("SELECT COALESCE(SUM(amount_krw_m), 0) AS u FROM financing_sources_uses WHERE project_id = ? AND kind = 'use'")
    .get(projectId) as { u: number }).u;
  if (uses <= 0) return out; // the balance blocker already names an empty plan
  const adopted = adoptedCaseCapex(projectId, db);
  if (adopted.total === null || adopted.total <= 0) {
    const why = !adopted.modelId
      ? "S8 채택 Business Case가 없습니다"
      : adopted.lines === 0
        ? "채택 케이스에 capex 행이 없습니다"
        : adopted.unitIssue
          ? "채택 케이스 capex 행 단위가 KRW_M으로 명시되어 있지 않습니다"
          : "채택 케이스 capex 합계가 양수가 아닙니다";
    out.advisories.push(`[권고·비차단] 자금 사용(uses) ${fmt(uses)} 백만 KRW를 S8 채택 투자금과 대사할 수 없습니다 — ${why}. 허용 오차 ±${S10_USES_RECONCILIATION_TOLERANCE * 100}% 대사는 사람이 직접 확인하세요.`);
    return out;
  }
  const deviation = Math.abs(uses - adopted.total) / adopted.total;
  if (deviation > S10_USES_RECONCILIATION_TOLERANCE + 1e-9) {
    out.blockers.push(
      `자금 사용(uses) ${fmt(uses)} 백만 KRW가 S8 채택 투자금 ${fmt(adopted.total)} 백만 KRW와 ${fmt(deviation * 100)}% 차이납니다 — 허용 오차 ±${S10_USES_RECONCILIATION_TOLERANCE * 100}% 초과 (자금조달 계획 또는 채택 케이스를 정리하세요)`,
    );
    out.missing.push(blocker("s10.uses_reconcile_adopted_investment"));
  }
  return out;
}

/** (b) downside DSCR headroom. */
export function s10CovenantHeadroom(db: Database, projectId: string): S10CheckResult {
  const out = empty();
  const debt = (db.query("SELECT COUNT(*) AS c FROM debt_instrument WHERE project_id = ?").get(projectId) as { c: number }).c;
  if (debt === 0) return out; // no debt, no covenant to test
  const fail = (reason: string) => {
    out.blockers.push(`부채 조달이 있는데 다운사이드 커버넌트 여력을 확인할 수 없거나 기준 미달입니다 — ${reason}`);
    out.missing.push(blocker("s10.downside_covenant_headroom"));
  };
  const view = covenantHeadroom(db as never, projectId);
  if (view.status !== "computed" || !view.simulation_id) {
    fail(view.reason === "no_simulation" ? "구조 시뮬레이션이 없습니다" : "커버넌트 테스트 결과가 없습니다");
    return out;
  }
  const dscr = db
    .query(
      "SELECT MIN(projected_value) AS minimum, SUM(breached) AS breached, COUNT(*) AS n FROM covenant_test WHERE simulation_id = ? AND LOWER(covenant_key) LIKE 'dscr%'",
    )
    .get(view.simulation_id) as { minimum: number | null; breached: number | null; n: number };
  if (dscr.n === 0 || dscr.minimum === null) {
    fail("DSCR 커버넌트 테스트가 없습니다");
  } else if ((dscr.breached ?? 0) > 0) {
    fail(`DSCR 커버넌트가 위반되었습니다 (${dscr.breached}개 기간)`);
  } else if (dscr.minimum < S10_MIN_DOWNSIDE_DSCR) {
    fail(`최소 DSCR ${fmt(dscr.minimum)}배가 기준 ${S10_MIN_DOWNSIDE_DSCR}배 미만입니다`);
  }
  return out;
}

/** (c) funding-certainty evidence on every source. */
export function s10FundingEvidence(db: Database, projectId: string): S10CheckResult {
  const out = empty();
  const rows = db
    .query("SELECT name, evidence_kind, evidence_ref FROM financing_sources_uses WHERE project_id = ? AND kind = 'source'")
    .all(projectId) as Array<{ name: string; evidence_kind: string | null; evidence_ref: string | null }>;
  const lacking = rows.filter((r) => !r.evidence_kind || !(r.evidence_ref ?? "").trim());
  if (lacking.length > 0) {
    out.blockers.push(
      `자금 확정성 증빙이 없는 조달원 ${lacking.length}건 — ${lacking.slice(0, 3).map((r) => r.name).join(", ")}${lacking.length > 3 ? " 외" : ""} (증빙 종류·참조 기록 필요)`,
    );
    out.missing.push(blocker("s10.funding_evidence"));
  }
  return out;
}

/** All three, for a project past the predicate date. */
export function s10M1Checks(db: Database, projectId: string): S10CheckResult {
  const parts = [s10UsesReconciliation(db, projectId), s10CovenantHeadroom(db, projectId), s10FundingEvidence(db, projectId)];
  return {
    blockers: parts.flatMap((p) => p.blockers),
    missing: parts.flatMap((p) => p.missing),
    advisories: parts.flatMap((p) => p.advisories),
  };
}

/** True when the project predates the M1 tightening and keeps the legacy S10 predicate. */
export function s10M1Grandfathered(db: Database, project: { id: string; created_at: string | null }): boolean {
  const pin = db.query("SELECT MIN(pinned_at) AS at FROM project_policy_pin WHERE project_id = ?").get(project.id) as { at: string | null };
  return (pin.at ?? project.created_at ?? "") < ADR_0187_P3_PREDICATE_DATE;
}
