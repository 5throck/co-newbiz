// @version 1.0.1
/**
 * app/web-next/lib/library.generated.ts is a checked-in projection of the
 * governance source files (checklists, procedures, ...). No generator lives in
 * the repo, so the projection is refreshed by hand after a source edit — and a
 * forgotten refresh silently serves the old checklist to the /library page and
 * the DD workspace. This guard fails when a projected entry no longer matches
 * its source file.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as yaml from "js-yaml";
import { LIBRARY_CHECKLIST_ITEMS, LIBRARY_CONTENT, LIBRARY_DOCS } from "../../app/web-next/lib/library.generated.ts";

const REPO = resolve(import.meta.dirname, "../..");

const normalize = (s: string) => s.replace(/\r\n/g, "\n");

// Entries known to be stale on purpose. Empty by design: refresh the projection with
//   bun scripts/co-newbiz/sync-library-projection.ts
// instead of listing an entry here. The test also fails if a listed entry is fresh.
const KNOWN_STALE_ITEMS = new Set<string>([]);
const KNOWN_STALE_CONTENT = new Set<string>([]);

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
        items: Array<{ id: string; text: string; mandatory: boolean; waiver_eligible: boolean; modes?: string[]; origins?: string[]; review_status?: string }>;
      };
      const items = doc.items.map((i) => ({
        id: i.id,
        text: i.text,
        mandatory: i.mandatory,
        waiver_eligible: i.waiver_eligible,
        ...(i.modes !== undefined ? { modes: i.modes } : {}),
        ...(i.origins !== undefined ? { origins: i.origins } : {}),
        ...(i.review_status !== undefined ? { review_status: i.review_status } : {}),
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

  // U-20261121-002: the drift gate must not depend on checkout EOL. JSON.stringify
  // serializes a real CRLF as the escape sequence `\r\n`, so a generator that reads
  // sources raw embeds a byte-identical document differently on a CRLF checkout and
  // `--check` reports it stale. This converts one projected source to CRLF, runs the
  // real drift check as a subprocess, and restores the original bytes in `finally`.
  test("--check is EOL-insensitive (CRLF working copy is not drift)", () => {
    const id = Object.keys(LIBRARY_CONTENT)[0];
    const target = join(REPO, LIBRARY_CONTENT[id].file);
    const original = readFileSync(target);
    try {
      const crlf = Buffer.from(
        original.toString("utf-8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"),
        "utf-8",
      );
      writeFileSync(target, crlf);
      const proc = spawnSync("bun", ["scripts/co-newbiz/sync-library-projection.ts", "--check"], {
        cwd: REPO,
        stdio: "pipe",
      });
      const out = new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr);
      expect(proc.status, `--check failed on a CRLF source (${target}):\n${out}`).toBe(0);
    } finally {
      writeFileSync(target, original);
    }
  });
});
