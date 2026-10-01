// @version 1.0.0
/**
 * app/web-next/lib/library.generated.ts is a checked-in projection of the
 * governance source files (checklists, procedures, ...). No generator lives in
 * the repo, so the projection is refreshed by hand after a source edit — and a
 * forgotten refresh silently serves the old checklist to the /library page and
 * the DD workspace. This guard fails when a projected entry no longer matches
 * its source file.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";
import { LIBRARY_CHECKLIST_ITEMS, LIBRARY_CONTENT, LIBRARY_DOCS } from "../../app/web-next/lib/library.generated.ts";

const REPO = resolve(import.meta.dirname, "../..");

const normalize = (s: string) => s.replace(/\r\n/g, "\n");

// Entries that were already stale when this guard was added (2026-10-01). Refresh
// the projection for one, then delete it from the list — the test fails if a listed
// entry is actually fresh, so the list can only shrink.
const KNOWN_STALE_ITEMS = new Set([
  "chk-brownfield-feasibility-checklist",
  "chk-greenfield-feasibility-checklist",
]);
const KNOWN_STALE_CONTENT = new Set([
  "chk-brownfield-feasibility-checklist",
  "chk-financing-plan-checklist",
  "chk-greenfield-feasibility-checklist",
  "chk-hr-dd-checklist",
  "chk-strategic-fit-screening-checklist",
  "chk-target-screening-checklist",
  "proc-greenfield-screening",
  "proc-brownfield-screening",
  "proc-greenfield-fs",
  "proc-brownfield-fs",
  "ref-phase-definitions",
  "rb-deployment-ko",
  "rb-deployment",
  "des-design-guide",
  "des-design-components-ko",
  "des-design-components",
]);

describe("library.generated.ts matches its source files", () => {
  test("every projected checklist: version, item_count and items equal the yaml", () => {
    const ids = Object.keys(LIBRARY_CHECKLIST_ITEMS);
    expect(ids.length).toBeGreaterThan(0);
    const stale: string[] = [];
    for (const id of ids) {
      const entry = LIBRARY_CONTENT[id];
      expect(entry, `${id} has no LIBRARY_CONTENT entry`).toBeDefined();
      const doc = yaml.load(readFileSync(join(REPO, entry.file), "utf-8")) as {
        version: string;
        items: Array<{ id: string; text: string; mandatory: boolean; waiver_eligible: boolean }>;
      };
      const items = doc.items.map((i) => ({
        id: i.id,
        text: i.text,
        mandatory: i.mandatory,
        waiver_eligible: i.waiver_eligible,
      }));
      const summary = LIBRARY_DOCS.find((d) => d.id === id);
      const fresh =
        JSON.stringify(LIBRARY_CHECKLIST_ITEMS[id]) === JSON.stringify(items) &&
        entry.version === doc.version &&
        entry.item_count === items.length &&
        summary?.version === doc.version &&
        summary?.item_count === items.length;
      if (!fresh) stale.push(id);
    }
    const unexpected = stale.filter((id) => !KNOWN_STALE_ITEMS.has(id));
    const nowFresh = [...KNOWN_STALE_ITEMS].filter((id) => !stale.includes(id));
    expect(unexpected, `items/version drifted from source — refresh library.generated.ts: ${unexpected.join(", ")}`).toEqual([]);
    expect(nowFresh, `fresh now — remove from KNOWN_STALE_ITEMS: ${nowFresh.join(", ")}`).toEqual([]);
  });

  test("every projected document's content equals its source file", () => {
    const stale: string[] = [];
    for (const [id, entry] of Object.entries(LIBRARY_CONTENT)) {
      const path = join(REPO, entry.file);
      if (!existsSync(path) || normalize(readFileSync(path, "utf-8")) !== normalize(entry.content)) stale.push(id);
    }
    const unexpected = stale.filter((id) => !KNOWN_STALE_CONTENT.has(id));
    const nowFresh = [...KNOWN_STALE_CONTENT].filter((id) => !stale.includes(id));
    expect(unexpected, `content drifted from source — refresh library.generated.ts: ${unexpected.join(", ")}`).toEqual([]);
    expect(nowFresh, `fresh now — remove from KNOWN_STALE_CONTENT: ${nowFresh.join(", ")}`).toEqual([]);
  });
});
