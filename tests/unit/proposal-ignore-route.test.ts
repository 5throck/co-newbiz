// @version 1.0.0
/**
 * POST /api/brownfield/{oppId}/target-proposals/ignore + suppression on the
 * proposal surfaces (design 2026-11-13-proposal-ignore-suppression §3.3/§3.4/
 * §3.6, DEC-20261113-04 rulings 3/4/7) — route contracts on the house
 * external-reference-supersede pattern: scratch SQLite + runMigrations +
 * next-route-dispatch, real login cookies per role.
 *
 * Locked in:
 *   - §5.1 persist: analyst POST → 201 { company_key, ignore_count }, the row
 *     keeps the RAW name + ignored_by, and an audit row lands with action
 *     target_proposal.ignore and target {oppId}:{key}.
 *   - §5.2 accumulation: 주식회사 한양 then 한양(주) — same key, count 2, two rows.
 *   - §5.3 gates: viewer → 403 role_required; unknown opportunity → 404 (not
 *     403); blank or all-marker company_name → 400 company_required.
 *   - §5.4 boundary at the route level (synthesis path): 2 ignore rows → the
 *     key's variants vanish from the web-search POST response; 1 row → they
 *     pass carrying ignore_count: 1; 0 rows → no ignore_count field.
 *   - §5.6 master GET suppression + §5.8 existing-name hardening: a key with
 *     2 ignores is absent from GET /target-proposals suggestions; the
 *     registered variant 주식회사 한양 also filters 한양(주) (the bare
 *     name-string Set.has could not); an unregistered 한양전자 still passes.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-proposal-ignore-route.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
// house guard (docs/context.md) — no suite may dial an LLM or the network
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { setWebResearchOverrideForTests } = await import("../../app/web-next/lib/web-research.ts");
const { setPlaywrightSearchOverrideForTests } = await import("../../app/web-next/lib/playwright-search.ts");
// Deterministic synthesis path: search unconfigured + headless stubbed empty.
setWebResearchOverrideForTests({ configured: false, sources: [] });
setPlaywrightSearchOverrideForTests([]);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { companyKey } = await import("../../app/web-next/lib/name-similarity.ts");

const NOW = "2026-11-13T10:00:00Z";
const PASSWORDS: Record<string, string> = { ana: "pw-ana-1234567", vic: "pw-vic-1234567" };
let analystCookie = "";
let viewerCookie = "";
let oppRoute = ""; // §5.1/5.2/5.3 ignore-route contract
let oppWeb = ""; // §5.4 web-search POST suppression boundary
let oppMaster = ""; // §5.6/5.8 master GET suppression + hardening

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const insertOpp = (id: string, name: string, marketScope: string) =>
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    id,
    name,
    marketScope,
    "selected",
    "ana",
    NOW,
  ]);

const ignore = (oppId: string, companyName: string, cookie = analystCookie) =>
  nextRequest(`/api/brownfield/${encodeURIComponent(oppId)}/target-proposals/ignore`, {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ company_name: companyName }),
  });

const masterSuggestions = async (oppId: string, cookie = analystCookie) => {
  const res = await nextRequest(`/api/brownfield/${encodeURIComponent(oppId)}/target-proposals`, {
    headers: { cookie },
  });
  const out = (await res.json()) as { data?: { suggestions?: Array<{ name_ko: string }> } };
  return (out.data?.suggestions ?? []).map((s) => s.name_ko);
};

const webSearchSuggestions = async (oppId: string, cookie = analystCookie) => {
  const res = await nextRequest(`/api/brownfield/${encodeURIComponent(oppId)}/target-proposals/web-search`, {
    method: "POST",
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const out = (await res.json()) as {
    data?: { source?: string; suggestions?: Array<{ company_name: string; ignore_count?: number }> };
  };
  return out.data ?? {};
};

const seedCompany = (nameKo: string) =>
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [`md-${nameKo}`, nameKo, NOW]);

const seedTarget = (oppId: string, companyName: string) =>
  db.run(
    "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    [`bt-${oppId}-${companyName}`, oppId, companyName, "pending", NOW, NOW],
  );

beforeAll(async () => {
  for (const [userId, role] of [
    ["ana", "analyst"],
    ["vic", "viewer"],
  ] as const) {
    await createUser(db, { userId, role, password: PASSWORDS[userId], createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("ana", PASSWORDS.ana);
  viewerCookie = await loginCookie("vic", PASSWORDS.vic);

  oppRoute = "opp-ignore-route";
  oppWeb = "opp-ignore-web";
  oppMaster = "opp-ignore-master";
  // market_scope "한양 산업" → root "한양" → LIKE '%한양%' reaches the seeded rows.
  for (const name of ["한양", "(주)한양", "한양전자"]) seedCompany(name);
  insertOpp(oppRoute, "무시 경로 계약 기회", "한양 산업");
  insertOpp(oppWeb, "무시 억제 경계 기회", "한양 산업");
  insertOpp(oppMaster, "무시 마스터 필터 기회", "한양 산업");
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    "ind-hanyang",
    "99201",
    "한양 산업",
    "hanyang-test",
    NOW,
  ]);
  seedTarget(oppMaster, "주식회사 한양"); // §5.8 — a registered VARIANT of the base name
});

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

const ignoreAuditsFor = (oppId: string) =>
  (
    db
      .query("SELECT target FROM audit_log WHERE action = 'target_proposal.ignore' AND target LIKE ?")
      .all(`${oppId}%`) as Array<{ target: string }>
  ).map((a) => a.target);

/** Envelope readers without non-null assertions (house 2026-11-12b A3). */
async function dataOf<T extends object>(res: Response): Promise<Partial<T>> {
  return ((await res.json()) as { data?: T }).data ?? {};
}
async function errCodeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: { code?: string } }).error?.code;
}
const countRows = (oppId: string) =>
  (
    db.query("SELECT COUNT(*) AS n FROM brownfield_target_proposal_ignore WHERE opportunity_id = ?").get(oppId) as {
      n: number;
    }
  ).n;

describe("POST /target-proposals/ignore — persist contract (§5.1, §5.2)", () => {
  test("analyst POST → 201 with the post-strip key and count 1; row keeps the RAW name + ignored_by; audit lands", async () => {
    const res = await ignore(oppRoute, "(주)한양");
    expect(res.status).toBe(201);
    const data = await dataOf<{ company_key: string; ignore_count: number }>(res);
    expect(data.company_key).toBe(companyKey("한양"));
    expect(data.ignore_count).toBe(1);
    const row = db
      .query(
        "SELECT company_name_raw, company_key, ignored_by FROM brownfield_target_proposal_ignore WHERE opportunity_id = ?",
      )
      .get(oppRoute) as { company_name_raw: string; company_key: string; ignored_by: string };
    expect(row.company_name_raw).toBe("(주)한양"); // exactly what the card showed
    expect(row.ignored_by).toBe("ana");
    expect(ignoreAuditsFor(oppRoute)).toEqual([`${oppRoute}:${companyKey("한양")}`]);
  });

  test("ignoring a variant accumulates: same key, second response count 2, two rows (count = rows)", async () => {
    const res = await ignore(oppRoute, "주식회사 한양");
    expect(res.status).toBe(201); // a repeated click is a NEW event — accumulation is the contract
    const data = await dataOf<{ company_key: string; ignore_count: number }>(res);
    expect(data.company_key).toBe(companyKey("한양"));
    expect(data.ignore_count).toBe(2);
    const rows = db
      .query("SELECT company_name_raw FROM brownfield_target_proposal_ignore WHERE opportunity_id = ?")
      .all(oppRoute) as Array<{ company_name_raw: string }>;
    expect(rows.map((r) => r.company_name_raw).sort()).toEqual(["(주)한양", "주식회사 한양"]);
  });

  test("a 300-char multi-line company_name is BOUNDED before the insert: whitespace collapsed, 120-char cap (QA fix 1)", async () => {
    const noisy = `  테스트\t공장\n(주)  ${"가".repeat(300)}`;
    const res = await ignore(oppRoute, noisy);
    expect(res.status).toBe(201);
    const data = await dataOf<{ company_key: string; ignore_count: number }>(res);
    const row = db
      .query(
        "SELECT company_name_raw FROM brownfield_target_proposal_ignore WHERE opportunity_id = ? AND company_name_raw LIKE '테스트%'",
      )
      .get(oppRoute) as { company_name_raw: string };
    const stored = row.company_name_raw;
    expect(stored.length).toBe(120); // sliced at the extractor cap
    expect(stored).not.toMatch(/[\n\t]/); // newlines/tabs collapsed to single spaces
    expect(stored.startsWith("테스트 공장 (주) ")).toBe(true); // trimmed + internal runs collapsed
    expect(data.company_key).toBe(companyKey(stored)); // what is stored and what is keyed stay self-consistent
  });
});

describe("POST /target-proposals/ignore — gates (§5.3)", () => {
  test("viewer → 403 role_required; unauthenticated → 401", async () => {
    const viewerRes = await ignore(oppRoute, "한양", viewerCookie);
    expect(viewerRes.status).toBe(403);
    expect(await errCodeOf(viewerRes)).toBe("role_required");
    const anonRes = await nextRequest(`/api/brownfield/${oppRoute}/target-proposals/ignore`, {
      method: "POST",
      body: JSON.stringify({ company_name: "한양" }),
    });
    expect(anonRes.status).toBe(401);
    // the denied calls recorded nothing (2 persist rows + the bounded-raw row)
    expect(countRows(oppRoute)).toBe(3);
  });

  test("unknown opportunity → 404 not_found (existence never leaked as a role answer)", async () => {
    const res = await ignore("opp-never-existed", "한양");
    expect(res.status).toBe(404);
    expect(await errCodeOf(res)).toBe("not_found");
  });

  test("blank and all-marker company_name → 400 company_required (an empty key is never stored)", async () => {
    for (const bad of ["", "   "]) {
      const res = await ignore(oppRoute, bad);
      expect(res.status).toBe(400);
      expect(await errCodeOf(res)).toBe("company_required");
    }
    const marker = await ignore(oppRoute, "(주)"); // collapses to the empty key
    expect(marker.status).toBe(400);
    expect(await errCodeOf(marker)).toBe("company_required");
    expect(countRows(oppRoute)).toBe(3);
  });
});

describe("web-search POST — suppression boundary at 0/1/2 (§5.4, synthesis path)", () => {
  test("0 ignores: variants appear with NO ignore_count field", async () => {
    const { source, suggestions } = await webSearchSuggestions(oppWeb);
    expect(source).toBe("synthesis"); // LLM none + search unconfigured → deterministic fallback
    const names = (suggestions ?? []).map((s) => s.company_name);
    expect(names).toContain("한양");
    expect(names).toContain("(주)한양");
    for (const s of suggestions ?? []) expect(s.ignore_count).toBeUndefined();
  });

  test("1 ignore: variants pass carrying ignore_count: 1 (the chip payload)", async () => {
    const res = await ignore(oppWeb, "주식회사 한양");
    expect(res.status).toBe(201);
    const { suggestions } = await webSearchSuggestions(oppWeb);
    const find = (name: string) => (suggestions ?? []).find((s) => s.company_name === name);
    expect(find("한양")?.ignore_count).toBe(1);
    expect(find("(주)한양")?.ignore_count).toBe(1); // same key → same chip payload
    expect(find("한양전자")?.ignore_count).toBeUndefined(); // different key, 0 events
  });

  test("2 ignores: every variant of the key vanishes from the response; other candidates survive", async () => {
    const res = await ignore(oppWeb, "한양(주)");
    expect(res.status).toBe(201);
    const { suggestions } = await webSearchSuggestions(oppWeb);
    const names = (suggestions ?? []).map((s) => s.company_name);
    expect(names).not.toContain("한양");
    expect(names).not.toContain("(주)한양");
    expect(names).toContain("한양전자");
  });
});

describe("master GET /target-proposals — suppression + existing-name hardening (§5.6, §5.8)", () => {
  test("a registered variant filters its own key: brownfield_target 주식회사 한양 removes 한양(주) (old code: bare Set.has kept it)", async () => {
    const names = await masterSuggestions(oppMaster);
    expect(names).not.toContain("한양"); // same key as the registered 주식회사 한양
    expect(names).not.toContain("(주)한양");
    expect(names).toContain("한양전자"); // unregistered base name still passes
  });

  test("a key with 2 ignore rows is absent from master suggestions; a 1-ignored key still appears", async () => {
    // (주)한양 and 한양전자 are still proposed → ignore 한양전자 twice.
    await ignore(oppMaster, "한양전자");
    await ignore(oppMaster, "한양전자");
    const names = await masterSuggestions(oppMaster);
    expect(names).not.toContain("한양전자"); // suppressed at 2
    // a one-ignore key stays visible on the master surface (no chip there — §8)
    seedCompany("한양상사"); // inside the LIKE window, its own key
    await ignore(oppMaster, "주식회사 한양상사"); // 1 event via a variant — door still open
    const after = await masterSuggestions(oppMaster);
    expect(after).toContain("한양상사");
  });

  test("the synthesis web-search path hardens the same way: registered 주식회사 한양 blocks 한양(주) (§5.8)", async () => {
    const { suggestions } = await webSearchSuggestions(oppMaster);
    const names = (suggestions ?? []).map((s) => s.company_name);
    expect(names).not.toContain("한양");
    expect(names).not.toContain("(주)한양");
  });
});
