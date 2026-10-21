// T-20261022-009: stage-meta's gate labels are the glossary Korean set — one
// vocabulary across the rail, decision panels, process chips and the deals page.
import { describe, expect, test } from "bun:test";
import { GATE_LABEL, STAGE_META, type GateMetaId } from "../../app/web-next/lib/stage-meta.ts";
import { GATE_LABEL as GLOSSARY_GATE_LABEL } from "../../app/web-next/lib/labels.ts";

describe("stage-meta gate labels", () => {
  test("every gate renders the glossary label from lib/labels.ts (single source)", () => {
    for (const g of Object.keys(GATE_LABEL) as GateMetaId[]) {
      expect(GATE_LABEL[g]).toBe(GLOSSARY_GATE_LABEL[g]);
    }
  });

  test("label keys are exactly the GateMetaId union (flow.spec gates only)", () => {
    const specGates = [...new Set(STAGE_META.flatMap((s) => s.gateIds))].sort();
    expect(Object.keys(GATE_LABEL).sort()).toEqual(specGates);
    // The S12 review pseudo-gate never leaks into the flow.spec gate vocabulary.
    expect(Object.keys(GATE_LABEL)).not.toContain("transition");
  });
});
