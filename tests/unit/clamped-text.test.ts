// @version 1.0.0
/** Required-capability note clamping: shared ClampedText used in S3, S5 and S8 cells. */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(import.meta.dirname, "../../app/web-next", p), "utf8");

test("ClampedText clamps to 2 lines with title tooltip and focusable element, no toggle", () => {
  const s = read("components/stages/ClampedText.tsx");
  expect(s).toContain("line-clamp-2");
  expect(s).toContain("title={text}");
  expect(s).toContain("tabIndex={0}");
  expect(s).not.toContain("aria-hidden");
  expect(s).not.toContain("CLAMP_THRESHOLD");
  expect(s).not.toContain("aria-expanded");
  expect(s).not.toContain("<button");
  expect(s).not.toContain("useState");
});

test("S3, S5 and S8 required-note cells use ClampedText", () => {
  const s3 = read("components/stages/synergy/SynergyLinkageTab.tsx");
  // ADR-0171: S5 and S8 render the required note through the one shared judgement table.
  const s5 = read("components/stages/CapabilityJudgementTable.tsx");
  const s8 = s5;
  expect(s3).toContain("<ClampedText text={r.requiredNote}");
  // The table is fixed-layout (ColGroup percentages), so the first column cannot widen the table.
  expect(s3).toContain("table-fixed-pct");
  expect(s5).toContain("<ClampedText text={r.required_note}");
  expect(s8).toContain("<ClampedText text={r.required_note}");
  expect(s3).not.toContain("` — ${r.requiredNote}`");
});

test("origin label helper: no S3 self-reference inside S3, shared by S3 and S4", async () => {
  const { gapSourceLabel } = await import("../../app/web-next/lib/capability-gap.ts");
  expect(gapSourceLabel("synergy_area", true)).toBe("시너지 영역에서 도출");
  expect(gapSourceLabel("synergy_area", false)).toBe("S3 시너지 영역에서 도출");
  expect(gapSourceLabel("s2_sketch", true)).toBe("S2 스케치에서 도출");
  expect(gapSourceLabel("s1_factors", false)).toBe("S1 요인에서 도출");
  expect(gapSourceLabel("manual", true)).toBe("직접 입력");
  const s3 = read("components/stages/synergy/SynergyLinkageTab.tsx");
  expect(s3).toContain("gapSourceLabel(r.source, true)");
  expect(s3).not.toContain("S3 시너지 영역");
  expect(read("components/stages/route-decision/EvalTab.tsx")).toContain("gapSourceLabel(r.source, false)");
});
