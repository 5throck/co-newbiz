import { describe, expect, test } from "bun:test";
import { buildCardChips, gateName } from "../../app/web-next/lib/deal-card-label.ts";

describe("buildCardChips", () => {
  test("keeps current stage separate from the gate that holds", () => {
    expect(buildCardChips("S11", ["fs"])).toEqual({ stageLabel: "S11", holdLabel: "FS HOLD" });
  });
  test("no hold gives no hold chip", () => {
    expect(buildCardChips("S8", [])).toEqual({ stageLabel: "S8", holdLabel: null });
  });
  test("multiple and duplicate gates are joined once", () => {
    expect(buildCardChips("S10", ["dd", "fs", "dd"]).holdLabel).toBe("DD·FS HOLD");
  });
  test("waiting label replaces stage chip only", () => {
    expect(buildCardChips("S4", ["screening"], "S4 대기")).toEqual({ stageLabel: "S4 대기", holdLabel: "Screening HOLD" });
  });
  test("unknown gate id falls back to raw id", () => {
    expect(gateName("zzz")).toBe("zzz");
  });
});
