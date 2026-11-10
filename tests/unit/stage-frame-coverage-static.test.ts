// @version 1.0.0
/**
 * D7 (B-5) — StageFrame/StageHandoffStrip mount coverage, test-enforced
 * (design 2026-11-11-admin-security-and-board-fixes §9).
 *
 * Acceptance: ZERO stage surfaces without the StageHandoffStrip. The strip
 * renders unconditionally inside StageFrame's head
 * (components/StageFrame.tsx, `StageHandoffStrip` mount) and `StageHandoff`
 * is its standalone form for non-framed stage screens — so statically proving
 * "every stage surface mounts StageFrame or StageHandoff" proves the strip
 * coverage. Per-file regex walk, same house pattern as
 * project-write-gating-static.test.ts.
 *
 * Fixture is hand-maintained (the §9 inventory, one entry per file); two
 * anti-rot guards: (1) a floor on the fixture size so an accidental list
 * wipe cannot pass vacuously, and (2) every STAGE_META stage S1–S12 must map
 * to at least one fixture entry via the entry's `stages` field, so a new
 * stage route without a fixture entry shows up as a coverage gap.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "../../app/web-next");
const read = (p: string) => readFileSync(join(WEB, p), "utf-8");

type StageId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9" | "S10" | "S11" | "S12";

interface Surface {
  /** Repo-relative path under app/web-next. */
  file: string;
  /** Stage ids this surface hosts (for the S1–S12 coverage companion check). */
  stages: StageId[];
  /** Non-framed stage screens must mount the standalone StageHandoff form. */
  expectStageHandoff?: boolean;
  /** Wrapper pages must consume their shared components/stages/*Stage.tsx component. */
  sharedStage?: string;
  /** S10 sub-tabs must import S10Frame. */
  expectS10Frame?: boolean;
}

const SURFACES: Surface[] = [
  // Deal tabs — the shared tab host mounts StageFrame per stage; the deal
  // overview is the carrier summary (StageFrame module family via StageRail).
  {
    file: "app/deals/[id]/[stage]/page.tsx",
    stages: ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"],
  },
  { file: "app/deals/[id]/page.tsx", stages: [] },
  // Project stage wrappers S8–S12 — each re-exports its shared *Stage component.
  { file: "app/projects/[id]/business-case/page.tsx", stages: ["S8"], sharedStage: "BusinessCaseStage.tsx" },
  { file: "app/projects/[id]/dd/page.tsx", stages: ["S9"], sharedStage: "DdStage.tsx" },
  { file: "app/projects/[id]/deal-structure/page.tsx", stages: ["S10"], sharedStage: "DealStructureStage.tsx" },
  { file: "app/projects/[id]/ic-review/page.tsx", stages: ["S11"], sharedStage: "IcReviewStage.tsx" },
  { file: "app/projects/[id]/portfolio/page.tsx", stages: ["S12"], sharedStage: "PortfolioStage.tsx" },
  // S10 sub-tabs — investment-structure working screens inside S10Frame.
  { file: "app/projects/[id]/debt/page.tsx", stages: ["S10"], expectS10Frame: true },
  { file: "app/projects/[id]/incentives/page.tsx", stages: ["S10"], expectS10Frame: true },
  { file: "app/projects/[id]/sites/page.tsx", stages: ["S10"], expectS10Frame: true },
  { file: "app/projects/[id]/permits/page.tsx", stages: ["S10"], expectS10Frame: true },
  // Direct-mount utility stage pages.
  { file: "app/projects/[id]/charter/page.tsx", stages: ["S12"] },
  { file: "app/projects/[id]/financial-analysis/page.tsx", stages: ["S8"] },
  { file: "app/projects/[id]/proxy-chain/page.tsx", stages: ["S9"] },
  { file: "app/projects/[id]/reports/page.tsx", stages: ["S11"] },
  { file: "app/projects/[id]/wacc/page.tsx", stages: ["S8"] },
  { file: "app/route-decision/page.tsx", stages: ["S4"] },
  { file: "app/brownfield/targets/[targetId]/page.tsx", stages: ["S6", "S7"] },
  // Non-framed stage screen: the standalone opportunity detail mounts StageHandoff.
  { file: "app/opportunities/[id]/page.tsx", stages: ["S2"], expectStageHandoff: true },
];

/**
 * Resolve whether the surface's source chain references StageFrame or
 * StageHandoff. Pages that only re-export a shared stage component get ONE
 * import hop into components/stages/* (the hop target is where StageFrame
 * lives — e.g. the S10 sub-tabs import S10Frame, which mounts StageFrame).
 */
function resolvesToStageFrame(src: string, depth = 0): boolean {
  if (/\bStageFrame\b|\bStageHandoff\b/.test(src)) return true;
  if (depth >= 1) return false;
  const marker = "components/stages/";
  for (const m of src.matchAll(/from "([^"]*components\/stages\/[^"]+\.ts(?:x)?)"/g)) {
    const spec = m[1];
    const sub = spec.slice(spec.indexOf(marker) + marker.length);
    try {
      if (resolvesToStageFrame(read(`components/stages/${sub}`), depth + 1)) return true;
    } catch {
      // Unreadable hop target — treat as unresolved; the naming assertion below reports it.
    }
  }
  return false;
}

for (const s of SURFACES) {
  test(`${s.file} mounts StageFrame or StageHandoff — StageHandoffStrip rides inside both`, () => {
    const src = read(s.file);
    expect(resolvesToStageFrame(src)).toBe(true);
  });
  if (s.expectStageHandoff) {
    test(`${s.file} (non-framed) mounts the standalone StageHandoff`, () => {
      expect(read(s.file)).toMatch(/\bStageHandoff\b/);
    });
  }
  if (s.sharedStage) {
    test(`${s.file} consumes its shared ${s.sharedStage} component`, () => {
      expect(read(s.file)).toContain(`components/stages/${s.sharedStage}`);
    });
  }
  if (s.expectS10Frame) {
    test(`${s.file} renders inside S10Frame`, () => {
      expect(read(s.file)).toMatch(/\bS10Frame\b/);
    });
  }
}

test("fixture floor — the §9 inventory cannot be wiped vacuously", () => {
  // 19 canonical surfaces at design time; a drop below means the fixture lost
  // entries, not that surfaces disappeared.
  expect(SURFACES.length).toBeGreaterThanOrEqual(19);
});

test("every STAGE_META stage S1–S12 maps to at least one fixture surface", () => {
  // stage-meta.ts is a data-only TS module — read the stage ids statically.
  const ids = [...read("lib/stage-meta.ts").matchAll(/id: "(S\d+)"/g)].map((m) => m[1]);
  expect(ids.length).toBeGreaterThanOrEqual(12);
  const covered = new Set(SURFACES.flatMap((s) => s.stages));
  const missing = ids.filter((id) => !covered.has(id as StageId));
  expect(missing).toEqual([]);
});
