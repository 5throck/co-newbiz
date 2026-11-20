// @version 1.0.0
// The capture-only committee demo seed (scripts/co-newbiz/seed-committee-turn-demo.ts): finished turn-engine
// sessions with minutes v2 on the Brown Field demo opportunity, one of them resumed (two sittings); idempotent.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "co-newbiz-committee-demo-"));
const DB_PATH = join(dir, "demo.sqlite");
const PREV_DB = process.env.CO_NEWBIZ_DB_PATH;
process.env.CO_NEWBIZ_DB_PATH = DB_PATH;

const { getDb, resetDb } = await import("../../db/client.ts");
const { seedS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { seedCommitteeTurnDemo } = await import("../../scripts/co-newbiz/seed-committee-turn-demo.ts");
const { sessionDurationSeconds } = await import("../../app/web-next/lib/committee-progress-view.ts");
const { getCommitteeSession, listCommitteeSessions } = await import("../../app/web-next/lib/committee-session.ts");

afterAll(() => {
  resetDb();
  if (PREV_DB === undefined) delete process.env.CO_NEWBIZ_DB_PATH;
  else process.env.CO_NEWBIZ_DB_PATH = PREV_DB;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe("committee turn demo seed", () => {
  test("seeds finished v2 meetings (S4 x2, S7 x1; one resumed) and is idempotent", async () => {
    const { opportunityId } = seedS1ToS12Demo(DB_PATH);
    const first = await seedCommitteeTurnDemo(DB_PATH, { opportunityId });
    expect(first.s4SessionIds).toHaveLength(2);

    for (const id of [...first.s4SessionIds, first.s7SessionId]) {
      const t = getCommitteeSession(id);
      expect(t?.engine).toBe("turns");
      expect((t?.turns ?? []).length).toBeGreaterThan(5);
      const row = getDb(DB_PATH).query("SELECT status, meta_json FROM process_run WHERE id = ?").get(id) as {
        status: string;
        meta_json: string;
      };
      expect(row.status).toBe("done");
      const meta = JSON.parse(row.meta_json);
      expect(meta.minutes_draft?.json?.version).toBe(2);
    }

    const attempts = (id: string): number =>
      JSON.parse(
        (getDb(DB_PATH).query("SELECT meta_json FROM process_run WHERE id = ?").get(id) as { meta_json: string })
          .meta_json,
      ).attempts.length;
    expect(attempts(first.s4SessionIds[0]!)).toBe(1);
    expect(attempts(first.s4SessionIds[1]!)).toBe(2);
    expect(attempts(first.s7SessionId)).toBe(1);

    const listed = listCommitteeSessions(opportunityId);
    expect(listed).toHaveLength(3);

    // Realistic clock: ~6 / ~5 (two sittings, the gap excluded) / ~8 minutes, a few hours apart.
    const minutes = (id: string): number => {
      const item = listed.find((x) => x.sessionId === id);
      return Math.round((sessionDurationSeconds(item as never) ?? -1) / 60);
    };
    expect(minutes(first.s4SessionIds[0] as string)).toBe(6);
    expect(minutes(first.s4SessionIds[1] as string)).toBe(5);
    expect(minutes(first.s7SessionId)).toBe(8);
    const started = [first.s7SessionId, first.s4SessionIds[1] as string, first.s4SessionIds[0] as string].map((id) =>
      Date.parse(listed.find((x) => x.sessionId === id)?.startedAt ?? ""),
    );
    expect(started[0]).toBeGreaterThan(started[1] as number);
    expect(started[1]).toBeGreaterThan(started[2] as number);
    // minutes v2 carries the rewritten sittings
    for (const id of first.s4SessionIds) {
      const row = getDb(DB_PATH).query("SELECT meta_json FROM process_run WHERE id = ?").get(id) as {
        meta_json: string;
      };
      const m = JSON.parse(row.meta_json);
      expect(Date.parse(m.minutes_draft.json.overview.held_at)).toBe(Date.parse(m.attempts[0].started_at));
    }

    const second = await seedCommitteeTurnDemo(DB_PATH, { opportunityId });
    expect(second).toEqual(first);
    expect(listCommitteeSessions(opportunityId)).toHaveLength(3);
  }, 60_000);
});
