import { describe, expect, test } from "bun:test";
import { validateReviewFields } from "../../checklists/_validate.ts";
import { DRAFT_AI_MARKER, draftAiSummary, reviewBadge, reviewStatusOf } from "../../app/web-next/lib/checklist-review-status.ts";
import { getChecklistItems } from "../../app/web-next/lib/library.ts";

const v = (item: Record<string, unknown>) => validateReviewFields("x.yaml", item, "x-01").map((i) => i.message);

describe("checklist review-status validator", () => {
  test("no fields is valid (reads as draft-AI)", () => {
    expect(v({})).toEqual([]);
  });
  test("explicit draft-AI is valid; reviewer on draft-AI is rejected", () => {
    expect(v({ review_status: "draft-AI" })).toEqual([]);
    expect(v({ review_status: "draft-AI", reviewer: "Kim" }).length).toBe(1);
  });
  test("unknown status rejected", () => {
    expect(v({ review_status: "approved" }).length).toBe(1);
  });
  test("counsel-reviewed / confirmed need reviewer and verified_on", () => {
    expect(v({ review_status: "confirmed" }).length).toBe(2);
    expect(v({ review_status: "counsel-reviewed", reviewer: "Kim" }).length).toBe(1);
    expect(v({ review_status: "confirmed", reviewer: "Kim", verified_on: "10/13" }).length).toBe(1);
    expect(v({ review_status: "confirmed", reviewer: "Kim", verified_on: "2026-10-13" })).toEqual([]);
  });
});

describe("review status view helpers", () => {
  test("missing status reads as draft-AI with the marker", () => {
    expect(reviewStatusOf({})).toBe("draft-AI");
    const b = reviewBadge({});
    expect(b.label).toBe("AI 작성·검토 전");
    expect(b.title).toBe(DRAFT_AI_MARKER);
  });
  test("reviewed and confirmed badges carry name and date", () => {
    expect(reviewBadge({ review_status: "counsel-reviewed", reviewer: "Kim", verified_on: "2026-10-13" }).label).toBe("법무 검토됨(Kim, 2026-10-13)");
    expect(reviewBadge({ review_status: "confirmed", reviewer: "Kim", verified_on: "2026-10-13" }).label).toBe("확정(Kim, 2026-10-13)");
  });
  test("draftAiSummary counts only in-scope items", () => {
    const s = draftAiSummary({
      domains: [{ items: [{}, { review_status: "confirmed" }, { scope: { judgeable: false } }, { scope: { judgeable: true } }] }],
    });
    expect(s).toEqual({ in_scope: 3, draft_ai: 2 });
  });
  test("projection items need no review fields (default draft-AI)", () => {
    const items = getChecklistItems("chk-strategic-fit-screening-checklist") ?? getChecklistItems("chk-strategic-fit") ?? [];
    for (const i of items) expect(reviewStatusOf(i)).toBe("draft-AI");
  });
});

import { validateSignoffs } from "../../checklists/_validate.ts";

describe("legal sign-off validator", () => {
  const cls = (status?: Record<string, unknown>) => new Map([["x-checklist", { items: new Map([["x-01", status ?? {}], ["x-02", {}]]) }]]);
  const good = {
    checklist: "x-checklist", checklist_version: "1.0.0",
    signer: { name: "Kim", qualification: "Attorney" }, approver: { name: "Park" },
    items: [{ item_id: "x-01", authority: { law: "L", mst: "1", article: "1" }, verdict: "confirm", signed_on: "2026-10-13" }],
  };
  const run = (doc: unknown, c = cls()) => validateSignoffs([{ file: "s.yaml", doc }], c).map((i) => i.message);
  test("valid file passes; no files and no claims pass", () => {
    expect(run(good)).toEqual([]);
    expect(validateSignoffs([], cls())).toEqual([]);
  });
  test("unknown item, bad verdict, missing signer/date rejected", () => {
    expect(run({ ...good, items: [{ ...good.items[0], item_id: "x-99" }] }).length).toBe(1);
    expect(run({ ...good, items: [{ ...good.items[0], verdict: "ok" }] }).length).toBe(1);
    expect(run({ ...good, signer: { name: "to be designated by the human decider", qualification: "" } }).length).toBe(2);
    expect(run({ ...good, items: [{ ...good.items[0], signed_on: "" }] }).length).toBe(1);
  });
  test("counsel-reviewed item needs matching confirm entry", () => {
    const c = cls({ review_status: "counsel-reviewed", reviewer: "Kim", verified_on: "2026-10-13" });
    expect(validateSignoffs([], c).length).toBe(1);
    expect(run(good, c)).toEqual([]);
    expect(run({ ...good, items: [{ ...good.items[0], verdict: "hold" }] }, c).length).toBe(1);
    expect(run(good, cls({ review_status: "confirmed", reviewer: "Lee", verified_on: "2026-10-13" })).length).toBe(1);
  });
});
