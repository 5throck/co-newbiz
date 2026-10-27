import { describe, expect, test } from "bun:test";
import {
  advisoryBlocks, clearByOptions, conditionsPayload, countersignProblem, detailList, enforcedBlocks, filterConditions,
  integrityErrorList, isAwaitingCountersign, recordedDecisionOf,
} from "../../app/web-next/lib/gate-integrity-view.ts";

describe("recorded vs effective decision", () => {
  test("recorded_decision wins over the effective (pending) verdict", () => {
    const row = { gate: "entity_ic", decision: "pending", recorded_decision: "go", awaiting_countersign: true };
    expect(recordedDecisionOf(row)).toBe("go");
    expect(isAwaitingCountersign(row)).toBe(true);
  });
  test("falls back to decision for responses without recorded_decision; pending alone is not a decision", () => {
    expect(recordedDecisionOf({ gate: "dd", decision: "hold" })).toBe("hold");
    expect(recordedDecisionOf({ gate: "dd", decision: "pending" })).toBeNull();
    expect(recordedDecisionOf(undefined)).toBeNull();
    expect(isAwaitingCountersign({ gate: "x", decision: "go", countersign_state: "pending_countersign" })).toBe(true);
    expect(isAwaitingCountersign({ gate: "x", decision: "go", countersign_state: "countersigned" })).toBe(false);
  });
});

describe("countersign form rules", () => {
  test("a reason is always needed; a conditional review needs at least one non-blank condition", () => {
    expect(countersignProblem("approved", " ", [])).toBe("reason");
    expect(countersignProblem("approved", "사유", [])).toBeNull();
    expect(countersignProblem("conditional", "사유", [{ text: "  " }])).toBe("conditions");
    expect(countersignProblem("conditional", "사유", [{ text: "조건" }])).toBeNull();
  });
  test("group_ic conditions cannot wait for the group sitting; payload drops blanks and empty owners", () => {
    expect(clearByOptions("group_ic")).toEqual(["establishment", "closing"]);
    expect(clearByOptions("entity_ic")).toContain("group_ic");
    expect(conditionsPayload([{ text: " a ", clear_by: "closing", owner_role: " " }, { text: "", clear_by: "closing", owner_role: "" }, { text: "b", clear_by: "establishment", owner_role: "법무" }]))
      .toEqual([{ text: "a", clear_by: "closing" }, { text: "b", clear_by: "establishment", owner_role: "법무" }]);
  });
});

describe("hard blocks and error lists", () => {
  test("only enforced blocks make GO blocked; shadow ones are advisory", () => {
    const blocks = [{ code: "validators_incomplete", keys: ["a"], enforced: false }, { code: "condition_open", keys: ["c"], enforced: true }];
    expect(enforcedBlocks(blocks).map((b) => b.code)).toEqual(["condition_open"]);
    expect(advisoryBlocks(blocks).map((b) => b.code)).toEqual(["validators_incomplete"]);
  });
  test("409 detail lists are read from strings and objects", () => {
    expect(detailList(["a", { text: "t" }, { id: "i" }, 5])).toEqual(["a", "t", "i"]);
    expect(integrityErrorList("validators_incomplete", { missing: ["antitrust"] })).toEqual(["antitrust"]);
    expect(integrityErrorList("condition_open", { conditions: [{ text: "x" }] })).toEqual(["x"]);
    expect(integrityErrorList("certification_unconfirmed", { certifications: ["iso"] })).toEqual(["iso"]);
    expect(integrityErrorList("other", { missing: ["a"] })).toEqual([]);
  });
  test("conditions filter by status", () => {
    const rows = [{ status: "open" }, { status: "cleared" }];
    expect(filterConditions(rows, "all")).toHaveLength(2);
    expect(filterConditions(rows, "open")).toEqual([{ status: "open" }]);
  });
});
