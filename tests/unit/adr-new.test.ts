// @version 1.0.0
/**
 * Tests for scripts/co-newbiz/adr-new.ts (the `adr:new` case of
 * newbiz.ts) — next-number scaffolding into a temp dir (the command's
 * --dir flag is the test hook), following the model.test.ts pattern of
 * importing the command's business function directly.
 */

import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEMP_DIR = mkdtempSync(join(tmpdir(), "adr-new-test-"));

afterAll(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

const { scaffoldAdr, slugifyTitle, nextAdrNumber } = await import("../../scripts/co-newbiz/adr-new.ts");

test("scaffolds the next free number with the workspace ADR section skeleton", () => {
  const first = scaffoldAdr({ title: "Adopt the test engine", date: "2026-08-21", dir: TEMP_DIR });
  expect(first).toMatchObject({ number: 1, slug: "adopt-the-test-engine" });
  const content = readFileSync(first.file, "utf8");
  expect(content).toContain("# ADR-0001: Adopt the test engine");
  expect(content).toContain("**Status**: Proposed"); // default status
  expect(content).toContain("**Date**: 2026-08-21");
  for (const section of ["## Context", "## Decision", "## Consequences"]) {
    expect(content).toContain(section);
  }

  // Second scaffold takes the next number — no hand-counting, no collision.
  const second = scaffoldAdr({ title: "Second decision", status: "Accepted", dir: TEMP_DIR });
  expect(second.number).toBe(2);
  expect(readFileSync(second.file, "utf8")).toContain("**Status**: Accepted");
});

test("re-running the same title is refused, never a silent overwrite or auto-bump", () => {
  expect(() => scaffoldAdr({ title: "Adopt the test engine", dir: TEMP_DIR })).toThrow(/refusing to overwrite/);
  // The refusal must not have minted a duplicate ADR-0003 either.
  expect(readdirSync(TEMP_DIR).filter((f) => f.endsWith(".md"))).toHaveLength(2);
});

test("slugifyTitle lowercases, hyphenates and caps length; unusable titles fail loudly", () => {
  expect(slugifyTitle("Adopt SQLite -- WAL Mode!")).toBe("adopt-sqlite-wal-mode");
  expect(slugifyTitle("A").length).toBeLessThanOrEqual(60);
  expect(slugifyTitle("a".repeat(100))).toHaveLength(60);
  expect(() => scaffoldAdr({ title: "   ", dir: TEMP_DIR })).toThrow(/non-empty/);
  expect(() => scaffoldAdr({ title: "!!!", dir: TEMP_DIR })).toThrow(/slug/); // no alphanumeric -> no slug
});

test("nextAdrNumber returns 0001 for an empty or missing dir", () => {
  expect(nextAdrNumber(join(TEMP_DIR, "no-such-subdir"))).toBe(1);
});
