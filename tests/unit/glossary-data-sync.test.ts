// @version 1.0.0
/**
 * app/web-next/lib/glossary-data.generated.ts is the projection the UI tooltip,
 * /api/glossary, MCP lookup_term and the admin glossary page read. It is
 * generated from glossary/*.yaml by scripts/co-newbiz/generate-glossary-data.ts
 * (ADR-0022, FR-SYS-04). This guard fails when the YAML and the projection diverge.
 */
import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";
import { GLOSSARY_TERMS } from "../../app/web-next/lib/glossary-data.generated.ts";

const REPO = resolve(import.meta.dirname, "../..");

describe("glossary-data.generated.ts matches glossary/*.yaml", () => {
  test("generator --check exits 0 (byte-identical projection)", () => {
    const proc = Bun.spawnSync(["bun", "scripts/co-newbiz/generate-glossary-data.ts", "--check"], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    const out = new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr);
    expect(proc.exitCode, out).toBe(0);
  });

  test("every YAML term is projected with identical fields, and nothing extra", () => {
    const expected: Array<Record<string, unknown>> = [];
    for (const f of readdirSync(join(REPO, "glossary")).filter((n) => n.endsWith(".yaml") && !n.startsWith("_")).sort()) {
      const doc = yaml.load(readFileSync(join(REPO, "glossary", f), "utf8"), { schema: yaml.JSON_SCHEMA }) as { terms: Record<string, Record<string, unknown>> };
      for (const [key, entry] of Object.entries(doc.terms)) expected.push({ key, ...entry });
    }
    expect(GLOSSARY_TERMS.length).toBe(expected.length);
    expect(JSON.parse(JSON.stringify(GLOSSARY_TERMS))).toEqual(expected);
  });
});
