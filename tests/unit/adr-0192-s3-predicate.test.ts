/**
 * ADR-0192 (option A) — S3 "strategic fit judgement" predicate, design
 * 2026-11-06-ai-review-stage-scope-fit-i18n-design.md Fix 2:
 *  (a) opportunities created on/after ADR_0192_PREDICATE_DATE satisfy the
 *      s3.strategic_fit_judgement blocker only when the synergy assessment
 *      is human-confirmed (synergy_score_confirmed_at set) AND carries a
 *      non-empty synergy_rationale — NOT via the S2 attractiveness rationale;
 *  (b) grandfathered opportunities (created before the date) keep the legacy
 *      `opp.rationale` check;
 *  (c) selection (s3.opportunity_selected) is still required in all cases —
 *      synergy-confirm never implies selection (no auto-select).
 *
 * Targets the S3 predicate directly via opportunityStageCompletion on a
 * constructed row — the predicate itself is pure (countSourcedCapabilityRows
 * only), no DB reads.
 */

import { test, expect, describe } from "bun:test";

const { opportunityStageCompletion } = await import("../../app/web-next/lib/process-flow.ts");

type OpportunityRow = import("../../app/web-next/lib/process-flow.ts").OpportunityRow;

const NEW_DATE = "2026-11-06T09:00:00Z"; // on/after ADR_0192_PREDICATE_DATE
const OLD_DATE = "2026-10-01T09:00:00Z"; // before ADR_0192_PREDICATE_DATE
const CAPABILITY_JSON = JSON.stringify({ rows: [{ capability: "테스트 역량", source: "manual" }] });

function opp(overrides: Partial<OpportunityRow>): OpportunityRow {
  return {
    id: "opp-test",
    name: "테스트 기회",
    market_scope: null,
    market_size_krw_m: null,
    growth_rate: null,
    value_chain_node: null,
    attractiveness_score: 70,
    synergy_score: 70,
    rationale: null,
    synergy_score_confirmed_at: null,
    synergy_rationale: null,
    status: "selected",
    target_universe_json: null,
    capability_gap_json: CAPABILITY_JSON,
    project_id: null,
    industry_id: null,
    created_at: NEW_DATE,
    sizing_version_id: null,
    target_scope_json: null,
    ...overrides,
  };
}

function s3(o: OpportunityRow) {
  return opportunityStageCompletion("S3", o);
}

const FIT_LABEL = "전략적 적합성 판단";
const SELECTED_LABEL = "기회 선택(selected)";

describe("ADR-0192 S3 predicate (option A)", () => {
  test("new opp: confirmed synergy + non-empty synergy_rationale satisfies the fit judgement", () => {
    const res = s3(opp({ synergy_rationale: "사람이 확정한 시너지 근거", synergy_score_confirmed_at: NEW_DATE }));
    expect(res.missing).not.toContain(FIT_LABEL);
    expect(res.complete).toBe(true);
  });

  test("new opp: unconfirmed synergy keeps the fit blocker even with rationale text", () => {
    const res = s3(opp({ synergy_rationale: "확정 전 권고 근거", synergy_score_confirmed_at: null }));
    expect(res.missing).toContain(FIT_LABEL);
    expect(res.complete).toBe(false);
  });

  test("new opp: confirmed-at set but blank synergy_rationale keeps the fit blocker", () => {
    const res = s3(opp({ synergy_rationale: "   ", synergy_score_confirmed_at: NEW_DATE }));
    expect(res.missing).toContain(FIT_LABEL);
  });

  test("new opp: the S2 attractiveness rationale alone does NOT satisfy the fit judgement", () => {
    const res = s3(opp({ rationale: "S2 매력도 근거", synergy_rationale: null, synergy_score_confirmed_at: null }));
    expect(res.missing).toContain(FIT_LABEL);
  });

  test("grandfathered opp: legacy opp.rationale check still applies", () => {
    const res = s3(
      opp({
        created_at: OLD_DATE,
        rationale: "레거시 근거",
        synergy_rationale: null,
        synergy_score_confirmed_at: null,
      }),
    );
    expect(res.missing).not.toContain(FIT_LABEL);
    expect(res.complete).toBe(true);
  });

  test("grandfathered opp: empty legacy rationale still blocks even with confirmed synergy", () => {
    const res = s3(
      opp({
        created_at: OLD_DATE,
        rationale: null,
        synergy_rationale: "확정된 시너지 근거",
        synergy_score_confirmed_at: NEW_DATE,
      }),
    );
    expect(res.missing).toContain(FIT_LABEL);
    expect(res.complete).toBe(false);
  });

  test("selection still required: confirmed synergy does not auto-select (new opp)", () => {
    const res = s3(opp({ synergy_rationale: "확정된 근거", synergy_score_confirmed_at: NEW_DATE, status: "assessed" }));
    expect(res.missing).toContain(SELECTED_LABEL);
    expect(res.complete).toBe(false);
  });

  test("selection still required: grandfathered opp without selected status blocks too", () => {
    const res = s3(opp({ created_at: OLD_DATE, rationale: "레거시 근거", status: "assessed" }));
    expect(res.missing).toContain(SELECTED_LABEL);
    expect(res.complete).toBe(false);
  });

  test("dropped status keeps the dropped blocker (unchanged)", () => {
    const res = s3(opp({ synergy_rationale: "확정", synergy_score_confirmed_at: NEW_DATE, status: "dropped" }));
    expect(res.missing).toContain(SELECTED_LABEL);
    expect(res.complete).toBe(false);
  });
});
