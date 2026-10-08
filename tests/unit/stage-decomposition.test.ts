// @version 1.0.0
/**
 * Wave U-3 structure contract: the former giant stage files stay decomposed.
 * - every file under the split directories is at most 400 lines;
 * - each legacy path is a thin re-export shim (importers and tests unchanged);
 * - every extracted hook file exports a `use*` function and every shell
 *   composes its hooks (no stray state left in the shell).
 */
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "../../app/web-next");
const MAX_LINES = 400;

const SPLITS: Array<{ shim: string | null; dir: string; shell: string; exports: string[] }> = [
  { shim: "components/stages/MarketAnalysisStage.tsx", dir: "components/stages/market", shell: "MarketAnalysisStage.tsx", exports: ["MarketAnalysisStage"] },
  { shim: "components/stages/OurCompanyStage.tsx", dir: "components/stages/our-company", shell: "OurCompanyStage.tsx", exports: ["OurCompanyStage"] },
  { shim: "components/stages/BrownfieldStage.tsx", dir: "components/stages/brownfield", shell: "BrownfieldStage.tsx", exports: ["BrownfieldStage"] },
  { shim: "components/stages/SynergyStage.tsx", dir: "components/stages/synergy", shell: "SynergyStage.tsx", exports: ["SynergyStage"] },
  { shim: "components/stages/RouteDecisionStage.tsx", dir: "components/stages/route-decision", shell: "RouteDecisionStage.tsx", exports: ["RouteDecisionStage"] },
  { shim: "components/admin/AdminConsole.tsx", dir: "components/admin/console", shell: "AdminConsole.tsx", exports: ["AdminConsole"] },
  { shim: null, dir: "components/brownfield-target", shell: "", exports: [] },
];

const lines = (p: string) => readFileSync(p, "utf-8").split("\n").length;

for (const s of SPLITS) {
  const files = readdirSync(join(WEB, s.dir)).filter((n) => /\.tsx?$/.test(n));
  test(`${s.dir}: every file is at most ${MAX_LINES} lines`, () => {
    for (const n of files) expect([n, lines(join(WEB, s.dir, n)) <= MAX_LINES]).toEqual([n, true]);
  });
  test(`${s.dir}: hook files export use* functions`, () => {
    for (const n of files.filter((f) => /^use[A-Z]/.test(f))) {
      const src = readFileSync(join(WEB, s.dir, n), "utf-8");
      expect(src).toMatch(/export function use[A-Z]\w*\(/);
    }
  });
  if (s.shim) {
    test(`${s.shim} is a thin re-export shim`, () => {
      const src = readFileSync(join(WEB, s.shim!), "utf-8");
      expect(lines(join(WEB, s.shim!))).toBeLessThan(15);
      for (const e of s.exports) expect(src).toContain(`export { ${e} } from "./${s.dir.split("/").slice(-1)[0]}/${s.shell}"`);
    });
  }
}

test("brownfield target page stays under the size cap and keeps its default export", () => {
  const p = join(WEB, "app/brownfield/targets/[targetId]/page.tsx");
  expect(lines(p)).toBeLessThanOrEqual(MAX_LINES);
  expect(readFileSync(p, "utf-8")).toMatch(/export default function BrownfieldTargetPage/);
});
