import { describe, expect, test } from "bun:test";
import {
  ACK_NOT_REACHED_CODE,
  EMPTY_ACK_STATE,
  ackNotReachedKeys,
  ackProblemsFromError,
  caveatsOfKey,
  closureView,
  divergenceMode,
  dropAckKeys,
  isDivergenceError,
  isNamedGate,
  mergedDivergenceReason,
  killScopeView,
  type GateSnapshotView,
  buildAckPayload,
  missingAckKeys,
  reasonHint,
  reconcileAckState,
  type SnapshotRequiredAck,
} from "../../app/web-next/lib/gate-ack-view.ts";

const req: SnapshotRequiredAck[] = [
  { key: "kill:p:a", kind: "kill_unassessed", procedure: "p" },
  { key: "kill:p:b", kind: "kill_unassessed", procedure: "p" },
  { key: "kill:q:c", kind: "kill_unassessed", procedure: "q" },
  { key: "rag:overall", kind: "rag_red" },
];

describe("gate-ack-view", () => {
  test("unchecked unassessed items are never sent and stay missing", () => {
    const st = { ...EMPTY_ACK_STATE, sharedReason: "데이터가 없어 평가하지 못함" };
    expect(buildAckPayload(req, st)).toEqual([]);
    expect(missingAckKeys(req, st)).toEqual(["kill:p:a", "kill:p:b", "kill:q:c", "rag:overall"]);
  });
  test("one entry per checked item carries the shared reason — across procedures, no covers", () => {
    const st = {
      ...EMPTY_ACK_STATE,
      checked: { "kill:p:a": true, "kill:q:c": true },
      sharedReason: "  데이터가 없어 평가하지 못함  ",
      reasons: { "rag:overall": "적색 등급을 인지함" },
    };
    expect(buildAckPayload(req, st)).toEqual([
      { key: "kill:p:a", kind: "kill_unassessed", reason: "데이터가 없어 평가하지 못함" },
      { key: "kill:q:c", kind: "kill_unassessed", reason: "데이터가 없어 평가하지 못함" },
      { key: "rag:overall", kind: "rag_red", reason: "적색 등급을 인지함" },
    ]);
    expect(missingAckKeys(req, st)).toEqual(["kill:p:b"]);
  });
  test("checked without any reason is still missing and is not sent", () => {
    const st = { ...EMPTY_ACK_STATE, checked: { "kill:p:a": true } };
    expect(buildAckPayload(req, st)).toEqual([]);
    expect(missingAckKeys(req, st)).toContain("kill:p:a");
  });
  test("per-item mode uses each item's own reason, ignores the shared one, and still needs the checkbox", () => {
    const st = {
      reasons: {
        "kill:p:a": "첫 항목 사유를 적음",
        "kill:p:b": "둘째 항목 사유를 적음",
        "kill:q:c": "셋째는 체크하지 않음",
      },
      checked: { "kill:p:a": true, "kill:p:b": true },
      sharedReason: "공통 사유는 쓰이지 않음",
      perItem: true,
    };
    expect(buildAckPayload(req, st)).toEqual([
      { key: "kill:p:a", kind: "kill_unassessed", reason: "첫 항목 사유를 적음" },
      { key: "kill:p:b", kind: "kill_unassessed", reason: "둘째 항목 사유를 적음" },
    ]);
    expect(missingAckKeys(req, st)).toEqual(["kill:q:c", "rag:overall"]);
  });
  test("reconcile keeps state for surviving keys and reports the rest", () => {
    const prev = {
      reasons: { "kill:p:a": "사유를 충분히 적음", "kill:q:c": "다른 사유를 적음" },
      checked: { "kill:p:a": true, "kill:q:c": true, "kill:p:b": true },
      sharedReason: "공통 사유",
      perItem: true,
    };
    const next = req.filter((r) => r.key !== "kill:q:c").concat({ key: "np:x:1", kind: "nonwaivable_open" });
    const r = reconcileAckState(prev, req, next);
    expect(r.state.reasons).toEqual({ "kill:p:a": "사유를 충분히 적음" });
    expect(r.state.checked).toEqual({ "kill:p:a": true, "kill:p:b": true });
    expect(r.state.sharedReason).toBe("공통 사유");
    expect(r.state.perItem).toBe(true);
    expect(r.dropped).toEqual(["kill:q:c"]);
    expect(r.added).toEqual(["np:x:1"]);
    expect(reconcileAckState(EMPTY_ACK_STATE, [], req).dropped).toEqual([]);
  });
  test("hints and server problems", () => {
    expect(reasonHint("")).toBeNull();
    expect(reasonHint("네")).not.toBeNull();
    expect(reasonHint("검토를 마쳤고 위험을 인지함")).toBeNull();
    const p = ackProblemsFromError("ack_required", {
      missing: ["a"],
      unknown: ["z"],
      invalid: [{ key: "b", problem: "cover_not_allowed" }],
    });
    expect(p.missing).toEqual(["a"]);
    expect(p.invalid[0].key).toBe("b");
    expect(
      ackProblemsFromError("rationale_insufficient", {
        field: "acknowledgements",
        items: [{ key: "k", reason: "too_short" }],
      }).weak,
    ).toEqual([{ key: "k", reason: "too_short" }]);
  });
});

// ── ADR-0193: stage-scoped kill criteria view model ──

const baseKill = { triggered: [], unassessed: [], inert: 0, inert_list: [] } as GateSnapshotView["kill"];

describe("kill scope view (ADR-0193)", () => {
  test("a legacy snapshot (no v2 fields) reads as empty, never throws", () => {
    const v = killScopeView(baseKill);
    expect(v.notReached).toEqual([]);
    expect(v.carriedIn).toEqual([]);
    expect(v.scheduled).toEqual([]);
    expect(v.caveats).toEqual([]);
    expect(v.partialTriggered).toEqual([]);
    expect(v.closedCarries).toBe(0);
  });
  test("not-reached items add no required acknowledgement: the ack list is the server's required_acks only", () => {
    const kill: GateSnapshotView["kill"] = {
      ...baseKill,
      not_reached: [
        {
          key: "p:x",
          procedure: "p",
          criterion_id: "x",
          title: "X",
          action: "halt",
          evaluable_from: "S5",
          reevaluate_at: "pre_fs",
        },
      ],
    };
    expect(killScopeView(kill).notReached).toHaveLength(1);
    expect(missingAckKeys([], EMPTY_ACK_STATE)).toEqual([]);
    expect(buildAckPayload([], EMPTY_ACK_STATE)).toEqual([]);
  });
  test("closed carries are evaluated and out_of_track; open and open_monitoring are not", () => {
    const c = (key: string, closure: "evaluated" | "open" | "out_of_track" | "open_monitoring") => ({
      key,
      title: key,
      from_decision_id: null,
      outcome: "false" as const,
      closure,
      action: "halt",
      evaluable_from: "S5",
      reevaluate_at: "pre_fs",
      route_decision_id: null,
    });
    const v = killScopeView({
      ...baseKill,
      carried_in: [c("a", "evaluated"), c("b", "open"), c("c", "out_of_track"), c("d", "open_monitoring")],
    });
    expect(v.carriedIn).toHaveLength(4);
    expect(v.closedCarries).toBe(2);
  });
  test("partial-input triggers are picked out, and stay triggered", () => {
    const t = (key: string, partial?: boolean) => ({
      key,
      procedure: "p",
      criterion_id: key,
      title: key,
      action: "halt",
      partial_input: partial,
    });
    const kill = { ...baseKill, triggered: [t("a", true), t("b", false), t("c")] };
    expect(killScopeView(kill).partialTriggered.map((x) => x.key)).toEqual(["a"]);
    expect(kill.triggered).toHaveLength(3);
  });
  test("every closure state has an icon (never colour alone); an unknown state degrades to open", () => {
    for (const c of ["evaluated", "open", "open_monitoring", "out_of_track"])
      expect(closureView(c).icon.length).toBeGreaterThan(0);
    expect(closureView("weird").id).toBe("open");
    expect(new Set(["evaluated", "open", "open_monitoring", "out_of_track"].map((c) => closureView(c).icon)).size).toBe(
      4,
    );
  });
  test("caveats are looked up per key and de-duplicated", () => {
    const kill = {
      ...baseKill,
      caveats: [
        { key: "p:a", caveat: "x" },
        { key: "p:a", caveat: "x" },
        { key: "p:b", caveat: "y" },
      ],
    };
    expect(caveatsOfKey(kill, "p:a")).toEqual(["x"]);
    expect(caveatsOfKey(kill, "p:z")).toEqual([]);
    expect(caveatsOfKey(baseKill, "p:a")).toEqual([]);
  });
  test("only real gate ids have a label; open_monitoring and blanks do not", () => {
    expect(isNamedGate("pre_fs")).toBe(true);
    expect(isNamedGate("target_screening")).toBe(true);
    expect(isNamedGate("open_monitoring")).toBe(false);
    expect(isNamedGate("")).toBe(false);
  });
});

describe("ack_not_reached recovery", () => {
  test("keys come from details; garbage degrades to none", () => {
    expect(ACK_NOT_REACHED_CODE).toBe("ack_not_reached");
    expect(ackNotReachedKeys({ keys: ["p:a", 3, "p:b"], snapshot_hash: "h" })).toEqual(["p:a", "p:b"]);
    expect(ackNotReachedKeys(null)).toEqual([]);
    expect(ackNotReachedKeys({ keys: "p:a" })).toEqual([]);
  });
  test("dropAckKeys removes entered state for the rejected keys only", () => {
    const st = {
      reasons: { "p:a": "r", "rag:overall": "rr" },
      checked: { "p:a": true, "p:b": true },
      sharedReason: "s",
      perItem: false,
    };
    expect(dropAckKeys(st, ["p:a"])).toEqual({
      reasons: { "rag:overall": "rr" },
      checked: { "p:b": true },
      sharedReason: "s",
      perItem: false,
    });
  });
});

describe("gate-ack-view: merged rationale / divergence field (ADR-0186 D9)", () => {
  test("mode: required for a GO against another AI recommendation, optional for HOLD/KILL, none when equal or no AI", () => {
    expect(divergenceMode("hold", "go")).toBe("required");
    expect(divergenceMode("kill", "go")).toBe("required");
    expect(divergenceMode("go", "hold")).toBe("optional");
    expect(divergenceMode("go", "kill")).toBe("optional");
    expect(divergenceMode("hold", "kill")).toBe("optional");
    expect(divergenceMode("go", "go")).toBeNull();
    expect(divergenceMode(null, "go")).toBeNull();
    expect(divergenceMode(undefined, "hold")).toBeNull();
  });

  test("the single field text is sent as divergence_reason (trimmed) exactly when the decision differs", () => {
    const text = "  AI는 인허가 일정을 우려했으나 서명된 인센티브 서한이 그 위험을 해소했습니다.  ";
    expect(mergedDivergenceReason("hold", "go", text)).toBe(text.trim());
    expect(mergedDivergenceReason("go", "hold", text)).toBe(text.trim());
    expect(mergedDivergenceReason("go", "go", text)).toBeUndefined();
    expect(mergedDivergenceReason(null, "go", text)).toBeUndefined();
    expect(mergedDivergenceReason("hold", "go", "   ")).toBeUndefined();
  });

  test("divergence 422s are recognised so they can be shown on the merged field", () => {
    expect(isDivergenceError("divergence_reason_required", { ai_recommended: "hold" })).toBe(true);
    expect(isDivergenceError("rationale_insufficient", { field: "divergence_reason", reason: "too_short" })).toBe(true);
    expect(isDivergenceError("rationale_insufficient", { field: "acknowledgements" })).toBe(false);
    expect(isDivergenceError("rationale_insufficient", null)).toBe(false);
    expect(isDivergenceError("ack_required", {})).toBe(false);
  });
});
