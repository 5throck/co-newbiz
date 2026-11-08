// @version 1.0.0
/**
 * canReEvaluateAttractiveness — owner decision 2026-11-08: re-evaluation stays
 * available for "selected" opportunities until the S4 route decision is
 * confirmed (and while no project exists). Plus the API signal it relies on:
 * route_confirmed is true only for a current final route decision, not a draft.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canReEvaluateAttractiveness } from "../../app/web-next/components/AttractivenessReEvaluate.tsx";

describe("canReEvaluateAttractiveness", () => {
  test("assessed: yes (with or without context)", () => {
    expect(canReEvaluateAttractiveness("assessed", true)).toBe(true);
    expect(canReEvaluateAttractiveness("assessed", true, { s4Confirmed: false, hasProject: false })).toBe(true);
  });
  test("selected before S4 confirmation, no project: yes", () => {
    expect(canReEvaluateAttractiveness("selected", true, { s4Confirmed: false, hasProject: false })).toBe(true);
    expect(canReEvaluateAttractiveness("selected", true)).toBe(true);
  });
  test("selected after S4 confirmation: no", () => {
    expect(canReEvaluateAttractiveness("selected", true, { s4Confirmed: true, hasProject: false })).toBe(false);
  });
  test("selected with a project: no", () => {
    expect(canReEvaluateAttractiveness("selected", true, { s4Confirmed: false, hasProject: true })).toBe(false);
  });
  test("dropped: no", () => {
    expect(canReEvaluateAttractiveness("dropped", true, { s4Confirmed: false, hasProject: false })).toBe(false);
  });
  test("identified: no toggle (first evaluation uses the always-open editor)", () => {
    expect(canReEvaluateAttractiveness("identified", true)).toBe(false);
  });
  test("no canAct: never", () => {
    for (const status of ["identified", "assessed", "selected", "dropped"] as const) {
      expect(canReEvaluateAttractiveness(status, false, { s4Confirmed: false, hasProject: false })).toBe(false);
    }
  });
});

describe("route_confirmed API signal", () => {
  const dir = mkdtempSync(join(tmpdir(), "co-newbiz-reeval-"));
  process.env.CO_NEWBIZ_DB_PATH = join(dir, "t.sqlite");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("draft-only route decision is not confirmed; current final is", async () => {
    const { resetDb, getDb } = await import("../../db/client.ts");
    const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
    const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
    const { runMigrations } = await import("../../db/migrate.ts");
    resetDb();
    runMigrations(process.env.CO_NEWBIZ_DB_PATH as string);
    const db = getDb(process.env.CO_NEWBIZ_DB_PATH);
    const now = new Date().toISOString();
    await createUser(db, { userId: "analyst1", role: "analyst", password: "pw-analyst-12345", createdBy: "test", now });
    approveUser(db, { userId: "analyst1", approvedBy: "test", now });
    db.run("UPDATE app_user SET must_change_password = 0");
    const login = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: "analyst1", password: "pw-analyst-12345" }),
    });
    const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
    db.run(
      "INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES ('opp-reeval', 'Reeval', 'selected', 'analyst1', ?)",
      [now],
    );
    db.run(
      `INSERT INTO route_decision (id, opportunity_id, track, decided_by, decided_at, status, is_current)
       VALUES ('rd-draft', 'opp-reeval', 'greenfield', 'analyst1', ?, 'draft', 0)`,
      [now],
    );
    const read = async () => {
      const list = await nextRequest("/api/opportunities", { headers: { cookie } });
      const row = ((await list.json()) as { data: Array<{ id: string; route_confirmed: number }> }).data.find(
        (r) => r.id === "opp-reeval",
      );
      const one = await nextRequest("/api/opportunities/opp-reeval", { headers: { cookie } });
      const detail = ((await one.json()) as { data: { route_confirmed: number } }).data;
      return [row?.route_confirmed, detail.route_confirmed];
    };
    expect(await read()).toEqual([0, 0]);
    db.run("UPDATE route_decision SET status = 'final', is_current = 1 WHERE id = 'rd-draft'");
    expect(await read()).toEqual([1, 1]);
  });
});
