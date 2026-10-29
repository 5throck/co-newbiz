// @version 1.0.0
/** parseAdrStatus reads both ADR header status formats, and the real ADR 0188 header. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseAdrStatus } from "../../app/web-next/lib/adr-status.ts";

describe("parseAdrStatus", () => {
  test("bold format", () => {
    expect(parseAdrStatus("# ADR-1: x\n\n**Status**: Accepted\n**Date**: 2026-01-01")).toBe("Accepted");
  });
  test("list format", () => {
    expect(parseAdrStatus("# ADR-2: x\n\n- Status: Accepted (2026-10-27) - note\n- Date: 2026-10-27")).toBe(
      "Accepted (2026-10-27) - note",
    );
  });
  test("missing status returns null", () => {
    expect(parseAdrStatus("# ADR-3: x\n\nno header")).toBeNull();
  });
  test("ADR-0188 file parses as Accepted", () => {
    const raw = readFileSync("docs/adr/0188-standalone-simulation-engine-device-layer.md", "utf-8");
    expect(parseAdrStatus(raw)).toBe("Accepted");
  });
});
