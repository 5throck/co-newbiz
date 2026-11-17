// @version 1.0.0
/**
 * Shared fixture for the S6 evaluation queue tests (ADR-0200 decision 8, design 2026-11-17 section 10.10). A temp SQLite,
 * one analyst and one viewer, opportunities with N DART candidates, and a deterministic fake runner: DART fetches are
 * answered in-process and can be held until the test releases them, so the tests decide when an item is "in flight".
 * No DART, LLM or web call leaves the process. Financial-only runs (`categories: "financial"`) need no LLM at all.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createHarness(tag: string) {
  const TMP = mkdtempSync(join(tmpdir(), `bf-queue-${tag}-`));
  const DB_PATH = join(TMP, "t.sqlite");
  process.env.CO_NEWBIZ_DB_PATH = DB_PATH;
  process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
  const savedKey = process.env.DART_API_KEY;
  process.env.DART_API_KEY = ["dart", "queue", "key"].join("-");

  const { resetDb, getDb } = await import("../../../db/client.ts");
  const { runMigrations } = await import("../../../db/migrate.ts");
  resetDb();
  runMigrations(DB_PATH);
  const db = getDb(DB_PATH);
  const { nextRequest } = await import("./next-route-dispatch.ts");
  const { createUser, approveUser } = await import("../../../db/lib/accounts.ts");
  const { ulid } = await import("../../../db/lib/ulid.ts");
  const repo = await import("../../../db/repositories/brownfield-eval-draft.repository.ts");
  const bulk = await import("../../../app/web-next/lib/brownfield-eval-bulk.ts");
  const queue = await import("../../../app/web-next/lib/brownfield-eval-queue.ts");
  const { listOrSeedCriteria } = await import("../../../app/web-next/lib/brownfield-eval-criteria.ts");

  const NOW = "2026-11-17T03:00:00.000Z";
  const ANALYST = `queue-analyst-${tag}`;
  const VIEWER = `queue-viewer-${tag}`;
  for (const [id, role] of [
    [ANALYST, "analyst"],
    [VIEWER, "viewer"],
  ] as const) {
    await createUser(db, { userId: id, role, password: `pw-${id}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = async (userId: string): Promise<string> => {
    const res = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId, password: `pw-${userId}-12345` }),
    });
    return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  };
  const analystCookie = await login(ANALYST);
  const viewerCookie = await login(VIEWER);
  const post = (path: string, body: unknown = {}, cookie = analystCookie) =>
    nextRequest(path, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
  const get = (path: string, cookie = analystCookie) => nextRequest(path, { headers: { cookie } });
  const data = async (res: Response) => (await res.json()) as { data: any; meta: any; error: any };

  // ── fake runner ──────────────────────────────────────────────────────────────────────────────────────────────
  const ctl = {
    used: 0, // DART calls the budget seam reports
    manual: false, // true: every DART fetch waits for release()
    pending: new Map<string, () => void>(), // corp -> resolver of a held fetch
    active: 0,
    peak: 0, // highest number of simultaneous fetches
    activeCorps: new Set<string>(),
    sameCandidateTwice: false, // true if one candidate was ever fetched by two workers at the same time
    fetched: [] as string[],
  };
  const release = (corp: string): void => {
    ctl.pending.get(corp)?.();
    ctl.pending.delete(corp);
  };
  const releaseAll = (): void => {
    for (const corp of [...ctl.pending.keys()]) release(corp);
  };
  const heldCorps = (): string[] => [...ctl.pending.keys()];
  const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
  async function until(cond: () => boolean, what: string, tries = 800): Promise<void> {
    for (let i = 0; i < tries; i++) {
      if (cond()) return;
      await tick(5);
    }
    throw new Error(`timed out waiting for ${what}`);
  }
  bulk.setStartCooldownForTests(0);
  bulk.setBulkEvalDepsForTests({
    now: () => new Date().toISOString(),
    isDartConfigured: () => true,
    isLlmConfigured: () => false,
    budget: () => ({ calls: ctl.used, budget: 15_000 }),
    validator: (async () => ({ validated: true })) as any,
    listDisclosuresSince: (async () => ({ complete: true, rows: [] })) as any,
    fetcher: (async (corp: string, opts: { fiscalYears?: number[] } = {}) => {
      ctl.fetched.push(corp);
      if (ctl.activeCorps.has(corp)) ctl.sameCandidateTwice = true;
      ctl.activeCorps.add(corp);
      ctl.active++;
      ctl.peak = Math.max(ctl.peak, ctl.active);
      try {
        if (ctl.manual) await new Promise<void>((resolve) => ctl.pending.set(corp, resolve));
        const years = opts.fiscalYears ?? [2021, 2022, 2023, 2024, 2025];
        const yearly = years.map((y) => ({
          year: String(y),
          items: [
            { name: "매출액", value: 1_000_000_000 * (1 + 0.12 * (y - 2020)), unit: "KRW" },
            { name: "영업이익", value: 100_000_000 * (1 + 0.12 * (y - 2020)), unit: "KRW" },
            { name: "당기순이익", value: 60_000_000 * (1 + 0.12 * (y - 2020)), unit: "KRW" },
            { name: "자산총계", value: 2_000_000_000, unit: "KRW" },
            { name: "부채총계", value: 800_000_000, unit: "KRW" },
            { name: "자본총계", value: 1_200_000_000, unit: "KRW" },
          ],
        }));
        return {
          corpCode: corp,
          found: true,
          items: [],
          yearly,
          yearOutcomes: years.map((year) => ({ year, outcome: "found" as const })),
          integrity: "ok",
        };
      } finally {
        ctl.activeCorps.delete(corp);
        ctl.active--;
      }
    }) as any,
  });

  let corpSeq = 10_000_000 + Math.floor(Math.random() * 1_000_000) * 20;
  /** An opportunity (selected) with `n` DART candidates, each with its own company master row and corp code. */
  function mkOpp(name: string, n: number): { opp: string; ids: string[]; corps: string[] } {
    const opp = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
      opp,
      name,
      "scope",
      "selected",
      ANALYST,
      NOW,
    ]);
    const ids: string[] = [];
    const corps: string[] = [];
    db.transaction(() => {
      for (let i = 0; i < n; i++) {
        const id = ulid();
        const corp = String(corpSeq++);
        const co = `${name}-${i}`;
        db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", [
          ulid(),
          co,
          corp,
          NOW,
        ]);
        db.run(
          "INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, created_at, updated_at) VALUES (?,?,?,?,?,?)",
          [id, opp, co, corp, NOW, NOW],
        );
        ids.push(id);
        corps.push(corp);
      }
    })();
    listOrSeedCriteria(opp, ANALYST, db);
    return { opp, ids, corps };
  }
  const start = (opp: string, body: Record<string, unknown> = {}, cookie = analystCookie) =>
    post(`/api/brownfield/${opp}/eval-draft-runs`, { categories: "financial", ...body }, cookie);
  const stateOf = (runId: string, targetId: string) =>
    repo.listRunItems(db, runId).find((i) => i.brownfield_target_id === targetId)?.state;

  return {
    db,
    repo,
    bulk,
    queue,
    ulid,
    ctl,
    ANALYST,
    VIEWER,
    viewerCookie,
    post,
    get,
    data,
    start,
    mkOpp,
    stateOf,
    release,
    releaseAll,
    heldCorps,
    tick,
    until,
    idle: () => queue.waitForQueueIdle(20_000),
    cleanup(): void {
      bulk.setBulkEvalDepsForTests(null);
      queue.setDispatchObserverForTests(null);
      queue.resetQueueForTests();
      resetDb();
      rmSync(TMP, { recursive: true, force: true });
      if (savedKey === undefined) delete process.env.DART_API_KEY;
      else process.env.DART_API_KEY = savedKey;
    },
  };
}
