import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUILTIN_DEV_ORIGINS,
  mergeDevOrigins,
  parseDevOrigins,
  readKeyFromEnvFile,
  resolveAllowedDevOrigins,
} from "../../app/web-next/lib/dev-origins.ts";

describe("parseDevOrigins", () => {
  test("splits on commas, spaces and newlines, dedupes, drops empties", () => {
    const r = parseDevOrigins("a.example.org, b.example.org\n c.example.org,,  a.example.org ,");
    expect(r.origins).toEqual(["a.example.org", "b.example.org", "c.example.org"]);
    expect(r.warnings).toEqual([]);
  });
  test("strips scheme, port and path with a warning", () => {
    const r = parseDevOrigins("https://X.example.org:7748/path, 10.0.0.5:3000");
    expect(r.origins).toEqual(["x.example.org", "10.0.0.5"]);
    expect(r.warnings.length).toBe(2);
  });
  test("rejects invalid tokens", () => {
    const r = parseDevOrigins("ok.example.org bad_host *.example.org -x.org a..b");
    expect(r.origins).toEqual(["ok.example.org"]);
    expect(r.warnings.length).toBe(4);
  });
  test("unset or empty yields nothing", () => {
    expect(parseDevOrigins(undefined).origins).toEqual([]);
    expect(parseDevOrigins("  ").origins).toEqual([]);
  });
});

describe("merge and resolve", () => {
  test("merge dedupes against defaults", () => {
    expect(mergeDevOrigins(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });
  test("unset keeps built-in defaults and tolerates a missing root .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "devorig-"));
    try {
      expect(resolveAllowedDevOrigins(dir, {}, () => {})).toEqual([...BUILTIN_DEV_ORIGINS]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("root .env fallback reads only the one key", () => {
    const dir = mkdtempSync(join(tmpdir(), "devorig-"));
    try {
      writeFileSync(join(dir, ".env"), 'SECRET_KEY=abc\nCO_NEWBIZ_ALLOWED_DEV_ORIGINS="new.example.org, 100.1.2.3"\n');
      expect(readKeyFromEnvFile(join(dir, ".env"))).toBe("new.example.org, 100.1.2.3");
      const out = resolveAllowedDevOrigins(dir, {}, () => {});
      expect(out).toContain("new.example.org");
      expect(out).toContain("100.1.2.3");
      expect(out).toContain("newbiz.bizknights.org");
      expect(out.some((o) => o.includes("abc"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("process.env wins over root .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "devorig-"));
    try {
      writeFileSync(join(dir, ".env"), "CO_NEWBIZ_ALLOWED_DEV_ORIGINS=file.example.org\n");
      const out = resolveAllowedDevOrigins(dir, { CO_NEWBIZ_ALLOWED_DEV_ORIGINS: "env.example.org" }, () => {});
      expect(out).toContain("env.example.org");
      expect(out).not.toContain("file.example.org");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
