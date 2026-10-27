import { describe, expect, test } from "bun:test";
import { EMPTY_ACK_STATE, ackProblemsFromError, buildAckPayload, missingAckKeys, reasonHint, reconcileAckState, visibleAckKeys, type SnapshotRequiredAck } from "../../app/web-next/lib/gate-ack-view.ts";

const req: SnapshotRequiredAck[] = [
  { key: "kill:p:a", kind: "kill_unassessed", procedure: "p" },
  { key: "kill:p:b", kind: "kill_unassessed", procedure: "p" },
  { key: "kill:q:c", kind: "kill_unassessed", procedure: "q" },
  { key: "rag:overall", kind: "rag_red" },
];

describe("gate-ack-view", () => {
  test("payload skips empty reasons and covers same-procedure items when shared", () => {
    const st = { reasons: { "kill:p:a": "데이터가 없어 평가하지 못함", "rag:overall": "적색 등급을 인지함" }, shared: { p: true } };
    expect(visibleAckKeys(req, st).map((r) => r.key)).toEqual(["kill:p:a", "kill:q:c", "rag:overall"]);
    expect(buildAckPayload(req, st)).toEqual([
      { key: "kill:p:a", kind: "kill_unassessed", reason: "데이터가 없어 평가하지 못함", covers: ["kill:p:b"] },
      { key: "rag:overall", kind: "rag_red", reason: "적색 등급을 인지함" },
    ]);
    expect(missingAckKeys(req, st)).toEqual(["kill:q:c"]);
  });
  test("reconcile keeps reasons for surviving keys and reports the rest", () => {
    const prev = { reasons: { "kill:p:a": "사유를 충분히 적음", "kill:q:c": "다른 사유를 적음" }, shared: {} };
    const next = req.filter((r) => r.key !== "kill:q:c").concat({ key: "np:x:1", kind: "nonwaivable_open" });
    const r = reconcileAckState(prev, req, next);
    expect(r.state.reasons).toEqual({ "kill:p:a": "사유를 충분히 적음" });
    expect(r.dropped).toEqual(["kill:q:c"]);
    expect(r.added).toEqual(["np:x:1"]);
    expect(reconcileAckState(EMPTY_ACK_STATE, [], req).dropped).toEqual([]);
  });
  test("hints and server problems", () => {
    expect(reasonHint("")).toBeNull();
    expect(reasonHint("네")).not.toBeNull();
    expect(reasonHint("검토를 마쳤고 위험을 인지함")).toBeNull();
    const p = ackProblemsFromError("ack_required", { missing: ["a"], unknown: ["z"], invalid: [{ key: "b", problem: "cover_not_allowed" }] });
    expect(p.missing).toEqual(["a"]);
    expect(p.invalid[0].key).toBe("b");
    expect(ackProblemsFromError("rationale_insufficient", { field: "acknowledgements", items: [{ key: "k", reason: "too_short" }] }).weak).toEqual([{ key: "k", reason: "too_short" }]);
  });
});
