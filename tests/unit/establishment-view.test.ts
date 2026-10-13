import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  assigneeView, buildStatusBody, defaultFormStatus, establishmentApplies, establishmentErrorText, evidenceRequired,
  notApplicableNote, eventSummary, reopenWarning, safeEvidenceHref, toMs, validateReopenReason, validateStatusForm, type EventView,
} from "../../app/web-next/lib/establishment-view.ts";
import { estStepColPct } from "../../app/web-next/components/stages/constants.ts";

const ev = (over: Partial<EventView>): EventView => ({
  id: "e1", step_no: 1, kind: "reopen", from_status: "done", to_status: "in_progress", from_assignee: null, to_assignee: null,
  reason: "사유 열 글자 이상 입니다", evidence_url: null, actor_name: "홍길동", actor_user_id: "u1", created_at: "2026-10-13T10:00:00.000Z", ...over,
});

describe("establishment-view", () => {
  test("status defaults to current changeable status, else in_progress", () => {
    expect(defaultFormStatus("halted")).toBe("halted");
    expect(defaultFormStatus("pending")).toBe("in_progress");
    expect(defaultFormStatus(undefined)).toBe("in_progress");
  });
  test("evidence is required only for done", () => {
    expect(evidenceRequired("done")).toBe(true);
    expect(evidenceRequired("halted")).toBe(false);
    expect(validateStatusForm({ status: "done", evidence_url: " ", note: "" })).toContain("증적");
    expect(validateStatusForm({ status: "done", evidence_url: "", note: "확인함" })).toBeNull();
    expect(validateStatusForm({ status: "halted", evidence_url: "", note: "" })).toBeNull();
  });
  test("status body has the new shape (status + origin, no owner/assignee)", () => {
    const b = buildStatusBody(2, { status: "done", evidence_url: " https://x.y/a ", note: "" }, "joint");
    expect(b).toEqual({ step_no: 2, status: "done", origin: "joint", evidence_url: "https://x.y/a", note: undefined });
  });
  test("reopen reason needs 10+ characters", () => {
    expect(validateReopenReason("짧음")).not.toBeNull();
    expect(validateReopenReason("열 글자가 넘는 재개 사유입니다")).toBeNull();
  });
  test("error codes map to Korean text, unknown codes keep the server message", () => {
    expect(establishmentErrorText("reopen_required", "x")).toContain("먼저 재개");
    expect(establishmentErrorText("assignee_not_member", "x")).toContain("구성원");
    expect(establishmentErrorText("weird", "서버 메시지")).toBe("서버 메시지");
  });
  test("applicability and note", () => {
    expect(establishmentApplies("internal")).toBe(true);
    expect(establishmentApplies("joint")).toBe(true);
    expect(establishmentApplies("acquisition")).toBe(false);
    expect(establishmentApplies(null)).toBe(false);
    expect(notApplicableNote("acquisition")).toContain("ADR-0047");
    expect(notApplicableNote("acquisition")).toContain("PMI 킥오프");
  });
  test("assignee view marks revoked members with text and unassigned rows", () => {
    expect(assigneeView(undefined)).toEqual({ name: "미지정", inactive: false });
    expect(assigneeView({ assignee_user_id: "u", assignee_name: "김", assignee_active: false })).toEqual({ name: "김", inactive: true });
    expect(assigneeView({ assignee_user_id: "u", assignee_name: null, assignee_active: true }).name).toBe("u");
  });
  test("evidence link only for http(s)", () => {
    expect(safeEvidenceHref("https://a.b/c")).toBe("https://a.b/c");
    expect(safeEvidenceHref("javascript:alert(1)")).toBeNull();
    expect(safeEvidenceHref("data room 링크")).toBeNull();
    expect(safeEvidenceHref(null)).toBeNull();
  });
  test("timestamps parse in ISO and SQLite forms", () => {
    expect(toMs("2026-10-13 10:00:00")).toBe(toMs("2026-10-13T10:00:00Z"));
  });
  test("reopen warning renders the server flag only (no client-side derivation)", () => {
    expect(reopenWarning(null)).toBeNull();
    expect(reopenWarning(undefined)).toBeNull();
    expect(reopenWarning({})).toBeNull();
    expect(reopenWarning({ reopened_after_gate: false, reopened_after_gate_detail: null })).toBeNull();
    expect(reopenWarning({ reopened_after_gate: true, reopened_after_gate_detail: { steps: [1, 3], count: 2, since: "2026-10-13" } }))
      .toEqual({ steps: [1, 3], count: 2, since: "2026-10-13" });
    // history alone never produces a warning any more
    expect(reopenWarning({ history: [ev({})] } as never)).toBeNull();
  });
  test("history rows show the call path; unknown adds nothing", () => {
    expect(eventSummary(ev({ via: "mcp" }))).toBe("완료 취소(재개) · MCP");
    expect(eventSummary(ev({ via: "ui" }))).toBe("완료 취소(재개) · 화면");
    expect(eventSummary(ev({ via: "unknown" }))).toBe("완료 취소(재개)");
    expect(eventSummary(ev({}))).toBe("완료 취소(재개)");
  });
  test("column presets sum to 100", () => {
    for (const n of [5, 6]) expect(estStepColPct(n).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
    expect(estStepColPct(6)).toHaveLength(6);
  });
});

describe("establishment panel wiring (source checks)", () => {
  const panel = readFileSync("app/web-next/components/stages/EstablishmentPanel.tsx", "utf8");
  const ic = readFileSync("app/web-next/components/stages/IcReviewStage.tsx", "utf8");
  test("uses shared components and the new endpoints", () => {
    expect(panel).toContain("<ColGroup");
    expect(panel).toContain("<RowMenu");
    expect(panel).toContain("/assignee");
    expect(panel).toContain("/reopen");
    expect(panel).toContain("cascade_step5");
    expect(panel).toContain("dependent_step_done");
  });
  test("both surfaces consume the server flag instead of deriving from history", () => {
    expect(panel).toContain("reopenWarning(est ?? fallbackReopen)");
    expect(panel).not.toContain("gateHistory");
    expect(ic).toContain("fallbackReopen={pkg?.establishment}");
    expect(ic).not.toContain("gateHistory");
  });
  test("IcReviewStage no longer PUTs establishment with the old body", () => {
    expect(ic).not.toContain("api.put");
    expect(ic).toContain("<EstablishmentPanel");
  });
});
