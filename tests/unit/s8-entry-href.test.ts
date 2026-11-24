// S8 entry hrefs (DEC-20261124-01, design 2026-11-21-s8-overview-tab § Defect Remediation 2):
// every in-app S8 entry without an explicit tab targets /projects/{id} (the 개요 page) so the
// business-case stage body never paints 재무적 타당성 before a redirect.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectStageHref, s8EntryHref } from "../../app/web-next/lib/project-stage-entry.ts";

const WEB = join(import.meta.dir, "../../app/web-next");
const read = (rel: string): string => readFileSync(join(WEB, rel), "utf8");

describe("S8 entry hrefs", () => {
  test("canonical S8 entry is /projects/{id}", () => {
    expect(s8EntryHref("p1")).toBe("/projects/p1");
  });

  test("deal-stage S8 with an empty query goes straight to /projects/{pid} (one hop)", () => {
    expect(projectStageHref("S8", "p1", "")).toBe("/projects/p1");
  });

  test("deal-stage S8 with a query keeps /projects/{pid}/business-case?{query}", () => {
    expect(projectStageHref("S8", "p1", "tab=financial")).toBe("/projects/p1/business-case?tab=financial");
    expect(projectStageHref("S8", "p 1", "tab=goals&x=1")).toBe("/projects/p%201/business-case?tab=goals&x=1");
  });

  test("other project stages are unchanged (with and without query)", () => {
    expect(projectStageHref("S9", "p1", "")).toBe("/projects/p1/dd");
    expect(projectStageHref("S10", "p1", "a=b")).toBe("/projects/p1/deal-structure?a=b");
    expect(projectStageHref("S11", "p1", "")).toBe("/projects/p1/ic-review");
    expect(projectStageHref("S12", "p1", "")).toBe("/projects/p1/portfolio");
  });

  test("the three entry points consume the shared helper (source pins)", () => {
    expect(read("components/StageFrame.tsx")).toContain("S8: (_d, p) => (p ? s8EntryHref(p) : null),");
    expect(read("app/projects/page.tsx")).toContain("href={s8EntryHref(p.id)}");
    expect(read("app/deals/[id]/[stage]/page.tsx")).toContain("router.replace(projectStageHref(stageId, pid, query));");
  });

  test("no S8 entry links the bare /business-case route", () => {
    expect(read("components/StageFrame.tsx")).not.toMatch(/projects\/\$\{p\}\/business-case/);
    expect(read("app/projects/page.tsx")).not.toMatch(/\/business-case/);
  });
});

describe("bare /business-case page wrapper", () => {
  const src = read("app/projects/[id]/business-case/page.tsx");
  test("decides on the raw ?tab= param and renders nothing before the stage body mounts", () => {
    expect(src).toContain('s8BareTabRedirect(params.id, searchParams.get("tab"))');
    expect(src).toContain("if (bareDest) router.replace(bareDest, { scroll: false });");
    // the early return precedes the stage element so a bare URL never commits BusinessCaseStage
    expect(src.indexOf("if (bareDest) return null;")).toBeGreaterThan(-1);
    expect(src.indexOf("if (bareDest) return null;")).toBeLessThan(src.indexOf("<BusinessCaseStage"));
  });
});
