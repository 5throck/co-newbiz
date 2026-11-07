import { describe, expect, test } from "bun:test";
import {
  EMPTY_ACK_STATE,
  ackProblemsFromError,
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
