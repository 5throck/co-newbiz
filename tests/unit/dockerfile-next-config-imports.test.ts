import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

// ── Docker-exec scheduler import surface (ADR-0189) ──────────────────────────
// The prod tick runs INSIDE the container (docker exec scripts/co-newbiz/
// schedule-tick.ts) and spawns run-job.ts / job-worker.ts as its children;
// schedule-tick and run-job statically import the full handler registry
// (scripts/co-newbiz/jobs/index.ts), so every relative import those files
// reach must have a runtime COPY or the tick dies at import.
// 2026-11-29 incident: prod ticks crashed every minute since ~Nov 20 on the
// missing app/web-next/lib/schedule/cron.ts — the ADR-0189 scheduler feature
// added the import edge without extending the runtime COPY list.

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTsFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const JOBS_DIR = join(ROOT, "scripts/co-newbiz/jobs");
const SCHEDULER_ENTRIES = [
  join(ROOT, "scripts/co-newbiz/schedule-tick.ts"),
  join(ROOT, "scripts/co-newbiz/scheduler-core.ts"),
  join(ROOT, "scripts/co-newbiz/run-job.ts"),
  join(ROOT, "scripts/co-newbiz/schedule-seed.ts"),
  join(ROOT, "scripts/co-newbiz/job-worker.ts"),
  ...walkTsFiles(JOBS_DIR),
];

describe("Dockerfile runtime stage covers the docker-exec scheduler import surface", () => {
  test("every relative import (transitive) from the scheduler entrypoints has a runtime COPY", () => {
    const dests = runtimeCopies();
    const seen = new Set<string>();
    for (const entry of SCHEDULER_ENTRIES) collect(entry, seen);
    const missing: string[] = [];
    for (const file of seen) {
      const inRepo = resolve("/repo", relative(ROOT, file));
      const covered = dests.some((d) => inRepo === d || inRepo.startsWith(`${d}/`));
      if (!covered) missing.push(relative(ROOT, file));
    }
    expect(missing).toEqual([]);
  });
});
