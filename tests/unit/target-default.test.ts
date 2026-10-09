// @version 1.0.0
import { describe, expect, test } from "bun:test";
import { resolveDefaultTargetId, resolveTargetScope } from "../../app/web-next/lib/target-default.ts";

const t = (targetId: string, isBound = false) => ({ targetId, isBound });

describe("target default resolution (ADR-0156 amendment 2026-10-09)", () => {
  test("fewer than two targets: no selector, project-level scope", () => {
    expect(resolveDefaultTargetId([])).toBeNull();
    expect(resolveTargetScope([t("a", true)], null)).toEqual({ activeId: null, scopeId: null, noGateBasis: false });
  });

  test("default is the S8-selected (bound) target and maps to the project-level scope", () => {
    const targets = [t("a"), t("b", true)];
    expect(resolveDefaultTargetId(targets)).toBe("b");
    expect(resolveTargetScope(targets, null)).toEqual({ activeId: "b", scopeId: null, noGateBasis: false });
  });

  test("a non-bound pick is sent as target_id", () => {
    expect(resolveTargetScope([t("a"), t("b", true)], "a")).toEqual({ activeId: "a", scopeId: "a", noGateBasis: false });
  });

  test("no S8 selection: first shortlisted target, per-target scope, flagged as no gate basis", () => {
    expect(resolveTargetScope([t("a"), t("b")], null)).toEqual({ activeId: "a", scopeId: "a", noGateBasis: true });
  });

  test("a stale pick falls back to the default", () => {
    expect(resolveTargetScope([t("a"), t("b", true)], "gone")).toEqual({ activeId: "b", scopeId: null, noGateBasis: false });
  });
});
