import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dealStageHref, opportunityStatusHref, stageSegment } from "../../app/web-next/lib/deal-links.ts";

const W = join(import.meta.dirname, "../../app/web-next");

describe("dealStageHref", () => {
  for (let n = 1; n <= 7; n++) {
    test(`S${n}`, () => {
      expect(dealStageHref("a1", `S${n}`)).toBe(`/deals/a1/s${n}`);
      expect(dealStageHref("a1", `s${n}`)).toBe(`/deals/a1/s${n}`);
    });
  }
  test("unknown or missing stage falls back to overview", () => {
    expect(dealStageHref("a1", "—")).toBe("/deals/a1");
    expect(dealStageHref("a1", "S13")).toBe("/deals/a1");
    expect(dealStageHref("a1", null)).toBe("/deals/a1");
    expect(dealStageHref("a1")).toBe("/deals/a1");
    expect(stageSegment("../x")).toBeNull();
  });
  test("encodes the id", () => {
    expect(dealStageHref("a/b c", "S3")).toBe("/deals/a%2Fb%20c/s3");
  });
  test("status mapping", () => {
    expect(opportunityStatusHref("x", "identified")).toBe("/deals/x/s2");
    expect(opportunityStatusHref("x", "assessed")).toBe("/deals/x/s3");
    expect(opportunityStatusHref("x", "selected")).toBe("/deals/x/s4");
    expect(opportunityStatusHref("x", "promoted")).toBe("/deals/x");
    expect(opportunityStatusHref("x", undefined)).toBe("/deals/x");
  });
});

describe("redirect-hop links removed", () => {
  for (const f of [
    "app/deals/page.tsx",
    "app/portfolio-view/page.tsx",
    "app/projects/page.tsx",
    "app/projects/[id]/process/page.tsx",
    "lib/portfolio-overlap.ts",
  ]) {
    test(f, () => {
      expect(readFileSync(join(W, f), "utf8")).not.toContain("/opportunities?opportunity=");
    });
  }
});
