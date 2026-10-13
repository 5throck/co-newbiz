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
