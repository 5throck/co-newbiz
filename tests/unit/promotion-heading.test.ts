// T-013 (review 2026-10-22): the promotion panel heading must derive its
// hand-off stages from the opportunity's track (finalStageOf over the process
// view) — a greenfield opportunity hands off S5 → S8, brownfield S7 → S8.
// Hardcoding S7 → S8 mislabeled every greenfield promotion surface.
import { describe, expect, test } from "bun:test";
// Computed specifier: the .tsx module is runtime-resolved by bun; tsc runs without --jsx.
const panelPath = "../../app/web-next/components/PromotionPanel.tsx";
const { promotionHandoffLabel } = (await import(panelPath)) as {
  promotionHandoffLabel: (track: string | null) => string | null;
};

describe("promotionHandoffLabel (PromotionPanel heading source)", () => {
  test("greenfield hands off S5 → S8", () => {
    expect(promotionHandoffLabel("greenfield")).toBe("S5 → S8");
  });

  test("brownfield hands off S7 → S8", () => {
    expect(promotionHandoffLabel("brownfield")).toBe("S7 → S8");
  });

  test("undecided track (S4 route pending) has no hand-off label", () => {
    expect(promotionHandoffLabel(null)).toBeNull();
  });
});
