import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const WEB = join(ROOT, "app/web-next");
const ENTRY = join(WEB, "next.config.ts");
const IMPORT_RE = /(?:import|export)\s[^"'`;]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\s*["'](\.{1,2}\/[^"']+)["']/g;

function resolveRelative(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, join(base, "index.ts")]) {
    if (existsSync(c) && !c.endsWith("/") && /\.\w+$/.test(c)) return c;
  }
  throw new Error(`Cannot resolve ${spec} from ${from}`);
}

function collect(file: string, seen = new Set<string>()): Set<string> {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(IMPORT_RE)) {
    const target = resolveRelative(file, (m[1] ?? m[2])!);
    if (!seen.has(target)) {
      seen.add(target);
      collect(target, seen);
    }
  }
  return seen;
}

function runtimeCopies(): string[] {
  const df = readFileSync(join(ROOT, "docker/Dockerfile"), "utf8");
  const stage = df.split(/^FROM .* AS runtime$/m)[1] ?? "";
  expect(stage.length).toBeGreaterThan(0);
  const dests: string[] = [];
  for (const line of stage.split("\n")) {
    const m = line.match(/^COPY\s+--from=build\s+(\S+)\s+(\S+)\s*$/);
    if (m) dests.push(resolve("/repo", m[2]!));
  }
  return dests;
}

describe("Dockerfile runtime stage covers next.config.ts local imports", () => {
  test("next.config.ts itself is copied", () => {
    expect(runtimeCopies()).toContain(resolve("/repo", relative(ROOT, ENTRY)));
  });

  test("every relative import (transitive) has a runtime COPY", () => {
    const dests = runtimeCopies();
    const missing: string[] = [];
    for (const file of collect(ENTRY)) {
      const inRepo = resolve("/repo", relative(ROOT, file));
      const covered = dests.some((d) => inRepo === d || inRepo.startsWith(`${d}/`));
      if (!covered) missing.push(relative(ROOT, file));
    }
    expect(missing).toEqual([]);
  });
});
