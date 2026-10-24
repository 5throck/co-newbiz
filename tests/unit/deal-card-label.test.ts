import { describe, expect, test } from "bun:test";

const { buildCardChips, gateName } = await import("../../app/web-next/lib/deal-card-label.ts");
const ko = require("../../app/web-next/locales/ko.json") as Record<string, unknown>;
// i18n re-pin (T3-6): the lib emits `common.gate.*` keys — resolve them through the
// ko catalog with a stub root translator, exactly as the ROOT `t()` does at render.
const tr = (key: string): string => key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], ko) as string;

describe("buildCardChips", () => {
  // Gate wording follows the glossary Korean set shared with lib/label-keys.ts (T-20261022-009).
  test("keeps current stage separate from the gate that holds", () => {
    const chips = buildCardChips("S11", ["fs"]);
    expect(chips.stageLabel).toBe("S11");
    expect(chips.holdLabelKeys).toEqual(["common.gate.fs"]);
    expect(`${chips.holdLabelKeys!.map(tr).join("·")} HOLD`).toBe("타당성 분석(FS) HOLD");
  });
  test("no hold gives no hold chip", () => {
    expect(buildCardChips("S8", [])).toEqual({ stageLabel: "S8", holdLabelKeys: null });
  });
  test("multiple and duplicate gates are joined once", () => {
    const keys = buildCardChips("S10", ["dd", "fs", "dd"]).holdLabelKeys!;
    expect(keys).toEqual(["common.gate.dd", "common.gate.fs"]);
    expect(`${keys.map(tr).join("·")} HOLD`).toBe("실사(DD)·타당성 분석(FS) HOLD");
  });
  test("waiting label replaces stage chip only", () => {
    const chips = buildCardChips("S4", ["screening"], "S4 대기");
    expect(chips.stageLabel).toBe("S4 대기");
    expect(`${chips.holdLabelKeys!.map(tr).join("·")} HOLD`).toBe("스크리닝 HOLD");
  });
  test("unknown gate id falls back to raw id", () => {
    expect(gateName("zzz")).toBe("zzz");
  });
});
