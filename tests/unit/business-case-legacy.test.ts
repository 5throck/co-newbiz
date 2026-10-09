// @version 1.0.0
/**
 * R2-E — legacy business-case notice detection (UX round 2).
 *
 * ADR-0143 made brownfield S8 per-target (subjectScope: shortlist); projects
 * promoted before it carry business_case_model rows with target_id NULL. The
 * helper counts them so the S8 screen can explain why existing models do not
 * satisfy the per-target predicate instead of a bare "Business Case가
 * 필요합니다". Detection only — nothing migrates or deletes.
 */
import { describe, expect, test } from "bun:test";
import { countLegacyUnassignedModels, isShortlistScoped } from "../../app/web-next/lib/business-case-legacy.ts";

describe("countLegacyUnassignedModels", () => {
  test("shortlist-scoped project: NULL-target models count as legacy", () => {
    const cases = [
      { target_id: null },
      { target_id: null },
      { target_id: "t1" },
      { target_id: "t1" },
    ];
    expect(countLegacyUnassignedModels(cases, [{ targetId: "t1" }])).toBe(2);
  });

  test("greenfield (no target axis): NULL is the correct value, never legacy", () => {
    expect(countLegacyUnassignedModels([{ target_id: null }], [])).toBe(0);
  });

  test("no cases: count is 0", () => {
    expect(countLegacyUnassignedModels([], [{ targetId: "t1" }])).toBe(0);
  });

  test("all models assigned: count is 0", () => {
    expect(countLegacyUnassignedModels([{ target_id: "t1" }, { target_id: "t2" }], [{ targetId: "t1" }, { targetId: "t2" }])).toBe(0);
  });
});

describe("isShortlistScoped", () => {
  test("target comparison rows present = shortlist-scoped", () => {
    expect(isShortlistScoped([{ targetId: "t1" }])).toBe(true);
  });
  test("no target rows = greenfield", () => {
    expect(isShortlistScoped([])).toBe(false);
  });
});
