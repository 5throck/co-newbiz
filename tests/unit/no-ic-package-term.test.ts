import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The field term is "투자심의 자료"; the old wording must not return to UI source.
const ROOT = join(import.meta.dir, "../../app/web-next");
const SKIP_DIRS = new Set(["node_modules", ".next"]);
const BANNED = "IC 패키지";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|json|ya?ml|md)$/.test(name) && !name.endsWith(".generated.ts")) out.push(p);
  }
  return out;
}

describe("legacy IC package wording", () => {
  test("does not appear in app/web-next source", () => {
    const hits = walk(ROOT).filter((f) => readFileSync(f, "utf8").includes(BANNED));
    expect(hits).toEqual([]);
  });
});
