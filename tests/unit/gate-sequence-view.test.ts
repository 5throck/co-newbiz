import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { currentTurn, gateSequenceBlocker, gateState } from "../../app/web-next/lib/gate-sequence-view.ts";

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
  test("group committee is locked until the entity committee is GO (i18n re-pin T3-6: the panel composes common.gate.lockedReason from the blocker)", () => {
    expect(gateSequenceBlocker(G, "entity_ic", null)).toBeNull();
    expect(gateSequenceBlocker(G, "group_ic", L("hold", null))).toBe("entity_ic");
    expect(gateSequenceBlocker(G, "group_ic", L("go", null))).toBeNull();
    // ko wording of the lock reason resolves through the catalog with the glossary gate name.
    const ko = JSON.parse(readFileSync("app/web-next/locales/ko.json", "utf8")) as Record<string, any>;
    const tr = (key: string): string => key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, any>)[k], ko) as string;
    expect(tr("common.gate.lockedReason").replace("{p1}", tr("common.gate.entity_ic")).replace("{p2}", tr("common.gate.group_ic"))).toContain("법인 투자심의위원회 GO");
    // the panel composes the reason from gateSequenceBlocker, not a Korean builder
    const panel = readFileSync("app/web-next/components/GateDecisionPanel.tsx", "utf8");
    expect(panel).toContain('gateSequenceBlocker(gates, form.gate, latest)');
    expect(panel).toContain('tr("common.gate.lockedReason"');
    expect(panel).not.toContain("gateLockedReason");
  });
  test("gateSequenceBlocker — the shared rule behind the lock and the route guard (T-20261022-011)", () => {
    // group_ic is blocked by the first earlier gate without a GO (hold, kill, or missing).
    expect(gateSequenceBlocker(G, "group_ic", null)).toBe("entity_ic");
    expect(gateSequenceBlocker(G, "group_ic", L("hold", null))).toBe("entity_ic");
    expect(gateSequenceBlocker(G, "group_ic", L("kill", null))).toBe("entity_ic");
    expect(gateSequenceBlocker(G, "group_ic", L("go", null))).toBeNull();
    expect(gateSequenceBlocker(G, "group_ic", L("go", "hold"))).toBeNull();
    // The first gate of the sequence and gates outside it are always open.
    expect(gateSequenceBlocker(G, "entity_ic", null)).toBeNull();
    expect(gateSequenceBlocker(["fs", "dd"], "fs", null)).toBeNull();
    expect(gateSequenceBlocker(G, "fs", null)).toBeNull();
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
