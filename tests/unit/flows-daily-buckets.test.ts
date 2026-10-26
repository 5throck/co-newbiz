// @version 1.0.0
/** summary.daily — design 2026-10-26-ledger-daily-buckets-design. */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_PATH = join(import.meta.dirname, "../..", "db/data/test-flows-daily.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { localDayKey, windowDays } = await import("../../app/web-next/lib/llm-daily.ts");

const NOW = new Date().toISOString();
let cookie = "";

/** Local noon, `back` days ago — far from any day boundary regardless of TZ. */
function noon(back: number): string {
  const d = new Date();
  d.setDate(d.getDate() - back);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}
function seed(createdAt: string, ok: number, cost: number | null, dry = 0) {
  db.run(
    `INSERT INTO llm_call_log (id, agent_key, purpose, source, provider, model, ok, latency_ms, created_by, created_at, cost_usd, is_dry_run)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ulid(), "a", "p", "llm", "openai", "m", ok, 1, "system", createdAt, cost, dry],
  );
}
async function daily(qs = "") {
  const r = await nextRequest(`/api/flows/runs${qs}`, { headers: { cookie } });
  return (await r.json()).data.summary.daily as Array<{ day: string; ok: number; failed: number; costUsd: number }>;
}
const dayOf = (back: number) => { const d = new Date(); d.setDate(d.getDate() - back); return localDayKey(d); };

beforeAll(async () => {
  await createUser(db, { userId: "alice", role: "analyst", password: "pw-alice-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "alice", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: "alice", password: "pw-alice-12345" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  // today: 3 ok + 1 failed; 2 days ago: 1 ok; 10 days ago: 2 failed; dry-run today excluded.
  for (let i = 0; i < 3; i++) seed(noon(0), 1, 0.5);
  seed(noon(0), 0, 0.25);
  seed(noon(2), 1, null);
  seed(noon(10), 0, 1);
  seed(noon(10), 0, 1);
  seed(noon(0), 1, 9, 1);
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("summary.daily", () => {
  test("whole summary is unchanged by limit/before", async () => {
    const get = async (qs: string) => (await (await nextRequest(`/api/flows/runs${qs}`, { headers: { cookie } })).json()).data.summary;
    const base = await get("?window=30d");
    expect(base.calls).toBe(7);
    expect(await get("?window=30d&limit=1")).toEqual(base);
    expect(await get(`?window=30d&limit=1&before=${encodeURIComponent(noon(1))}`)).toEqual(base);
  });
  test("7d: zero-filled, ascending, counts per day, dry-run excluded", async () => {
    const d = await daily("?window=7d");
    expect(d.length).toBeGreaterThanOrEqual(7);
    expect(d.length).toBeLessThanOrEqual(8);
    expect(d.map((b) => b.day)).toEqual([...d.map((b) => b.day)].sort());
    const today = d.at(-1)!;
    expect(today).toEqual({ day: dayOf(0), ok: 3, failed: 1, costUsd: 1.75 });
    expect(d.find((b) => b.day === dayOf(2))).toEqual({ day: dayOf(2), ok: 1, failed: 0, costUsd: 0 });
    expect(d.find((b) => b.day === dayOf(1))).toEqual({ day: dayOf(1), ok: 0, failed: 0, costUsd: 0 });
    expect(d.find((b) => b.day === dayOf(10))).toBeUndefined();
  });
  test("24h spans today (and yesterday boundary day); 30d includes the 10-day-old row", async () => {
    const d24 = await daily("?window=24h");
    expect(d24.length).toBeLessThanOrEqual(2);
    expect(d24.at(-1)!.day).toBe(dayOf(0));
    const d30 = await daily("?window=30d");
    expect(d30.length).toBeGreaterThanOrEqual(30);
    expect(d30.find((b) => b.day === dayOf(10))).toEqual({ day: dayOf(10), ok: 0, failed: 2, costUsd: 2 });
  });
  test("includeDryRun=1 adds dry-run rows", async () => {
    const d = await daily("?window=7d&includeDryRun=1");
    expect(d.at(-1)).toEqual({ day: dayOf(0), ok: 4, failed: 1, costUsd: 10.75 });
  });
  test("unaffected by limit and before", async () => {
    const base = await daily("?window=7d");
    expect(await daily("?window=7d&limit=1")).toEqual(base);
    expect(await daily(`?window=7d&limit=1&before=${encodeURIComponent(noon(1))}`)).toEqual(base);
  });
  test("windowDays is continuous across month boundaries", () => {
    expect(windowDays(new Date(2026, 9, 30, 8), new Date(2026, 10, 2, 9))).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});
