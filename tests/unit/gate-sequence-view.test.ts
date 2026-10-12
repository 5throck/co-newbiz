import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { currentTurn, gateLockedReason, gateState, IC_STEP_LABEL } from "../../app/web-next/lib/gate-sequence-view.ts";

const G = ["entity_ic", "group_ic"];
const L = (e: string | null, g: string | null) => [{ gate: "entity_ic", decision: e }, { gate: "group_ic", decision: g }];

describe("gate-sequence-view", () => {
  test("state defaults to pending", () => {
    expect(gateState(null, "entity_ic")).toBe("pending");
    expect(gateState(L("hold", null), "entity_ic")).toBe("hold");
    expect(gateState(L("go", "kill"), "group_ic")).toBe("kill");
  });
  test("turn is the first gate without GO, last when all GO", () => {
    expect(currentTurn(G, null)).toBe("entity_ic");
    expect(currentTurn(G, L("hold", null))).toBe("entity_ic");
    expect(currentTurn(G, L("go", null))).toBe("group_ic");
    expect(currentTurn(G, L("go", "go"))).toBe("group_ic");
  });
  test("group committee is locked until the entity committee is GO", () => {
    expect(gateLockedReason(G, "entity_ic", null, IC_STEP_LABEL)).toBeNull();
    expect(gateLockedReason(G, "group_ic", L("hold", null), IC_STEP_LABEL)).toContain("법인 투자심의위원회 GO");
    expect(gateLockedReason(G, "group_ic", L("go", null), IC_STEP_LABEL)).toBeNull();
  });
});

describe("S11 merged decision section (source checks)", () => {
  const ic = readFileSync("app/web-next/components/stages/IcReviewStage.tsx", "utf8");
  const panel = readFileSync("app/web-next/components/GateDecisionPanel.tsx", "utf8");
  test("exactly one GateDecisionPanel with both gates in sequence mode", () => {
    expect(ic.match(/<GateDecisionPanel/g)?.length).toBe(1);
    expect(ic).toContain('gates={["entity_ic", "group_ic"]}');
    expect(ic).toContain("sequence");
    expect(ic).not.toContain("#gate-decision-group_ic");
  });
  test("jump anchors match every gate of a multi-gate panel", () => {
    expect(panel).toContain('[data-gate-form~="${gate}"]');
    expect(panel).toContain('panelKey.replace(/,/g, " ")');
  });
  test("single-gate panels are untouched (sequence is opt-in)", () => {
    expect(panel).toContain("sequence = false");
    expect(panel).toContain("const seq = sequence && gates.length > 1");
  });
});
