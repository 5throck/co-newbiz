import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDb } from "../../db/client.ts";
import { seedS1ToS12Demo } from "../../scripts/co-newbiz/seed-s1-s12-demo.ts";
import { evaluateProcess } from "../../app/web-next/lib/process-flow.ts";
import { findGateDecisionReferenceIssues } from "../../scripts/co-newbiz/db-integrity.ts";
import { getDb } from "../../db/client.ts";

let dir: string | null = null;

afterEach(() => {
  resetDb();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("S1-S12 demo seed", () => {
  test("creates an idempotent chain whose opportunity and project evaluations complete", () => {
    dir = mkdtempSync(join(tmpdir(), "co-newbiz-s1s12-"));
    const dbPath = join(dir, "demo.sqlite");
    const first = seedS1ToS12Demo(dbPath);
    const second = seedS1ToS12Demo(dbPath);

    expect(second).toEqual(first);
    const opp = evaluateProcess({ type: "opportunity", id: first.opportunityId });
    const project = evaluateProcess({ type: "project", id: first.projectId });

    expect(opp.completedStages).toContain("S7");
    expect(project.completedStages).toContain("S12");
    expect(project.currentStage).toBeNull();
    expect(findGateDecisionReferenceIssues(getDb(dbPath))).toEqual([]);
  });
});
