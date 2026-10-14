// @version 1.0.0
/**
 * ADR-0172 amendment 2026-10-14 (2): S3 drops 해소 힌트 and 보유 주체. The S3 PUT preserves the S5-owned
 * resolution and the legacy held.holders when the client omits them. Temp DB only; no LLM, no network.
 */
import { test, expect, describe, beforeAll } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(ROOT, "db/data/test-capability-s3-simplification.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const cg = await import("../../app/web-next/lib/capability-gap.ts");
const lk = await import("../../app/web-next/lib/capability-linkage.ts");

const read = (p: string) => readFileSync(join(ROOT, "app/web-next", p), "utf8");

describe("S3 PUT preserves S5-owned resolution and legacy holders", () => {
  const USER = "s3-analyst";
  let cookie = "";
  const opp = ulid();
  const stored = () => cg.parseGapRegister((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(opp) as { j: string | null }).j).rows;
  const put = (rows: unknown[]) => nextRequest(`/api/opportunities/${opp}/capability-gap`, { method: "PUT", headers: { cookie }, body: JSON.stringify({ rows }) });
  beforeAll(async () => {
    const NOW = new Date().toISOString();
    await createUser(db, { userId: USER, role: "analyst", password: `pw-${USER}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const login = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: USER, password: `pw-${USER}-12345` }) });
    cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, "S3 기회", "산업", "selected", USER, NOW]);
  });

  test("S5 sets resolution; an S3 save without resolution leaves it unchanged; holders preserved too", async () => {
    // legacy state: holders + evidence stored by an earlier version, resolution set by S5
    const first = await put([{ id: "r1", capability: "정밀 가공", source: "manual", necessity: "essential", held: { status: "partial", holders: ["A사", "B사"], evidence: "프로필 인용" }, resolution: "partner" }]);
    expect(first.status).toBe(200);
    expect(stored()[0]).toMatchObject({ resolution: "partner", held: { holders: ["A사", "B사"] } });
    // S3 save as the current client sends it: no resolution key, held without holders, edited evidence
    const res = await put([{ id: "r1", capability: "정밀 가공", source: "manual", necessity: "essential", held: { status: "partial", evidence: "수정된 근거" }, currentLevel: "서술" }]);
    expect(res.status).toBe(200);
    const row = stored()[0];
    expect(row.resolution).toBe("partner");
    expect(row.held.holders).toEqual(["A사", "B사"]);
    expect(row.held.evidence).toBe("수정된 근거");
    expect(row.currentLevel).toBe("서술");
    const data = ((await res.json()) as any).data;
    expect(data.rows[0]).toMatchObject({ resolution: "partner", held: { holders: ["A사", "B사"] } });
  });

  test("S5 changes the resolution after S3 stored; a later S3 save still keeps the newer value", async () => {
    const j = JSON.parse((db.query("SELECT capability_gap_json j FROM opportunity WHERE id = ?").get(opp) as { j: string }).j);
    j.rows[0].resolution = "hire";
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [JSON.stringify(j), opp]);
    await put([{ id: "r1", capability: "정밀 가공", source: "manual", necessity: "essential", held: { status: "partial", evidence: "또 수정" } }]);
    expect(stored()[0].resolution).toBe("hire");
  });

  test("new rows without resolution/holders get null/empty; rows are matched by id only", async () => {
    await put([
      { id: "r1", capability: "정밀 가공", source: "manual", held: { status: "partial", evidence: "e" } },
      { id: "r2", capability: "신규", source: "manual", held: { status: "unevaluated" } },
    ]);
    const rows = stored();
    expect(rows.find((r) => r.id === "r2")).toMatchObject({ resolution: null, held: { holders: [] } });
    expect(rows.find((r) => r.id === "r1")?.resolution).toBe("hire");
  });

  test("an explicit client value still wins (API compat); omitting is what preserves", () => {
    const merged = cg.preserveStoredOwnedFields([{ id: "r1", resolution: null, held: { holders: [] } }], [{ id: "r1", resolution: "build", held: { holders: ["A"] } } as any]) as any[];
    expect(merged[0].resolution).toBeNull();
    expect(merged[0].held.holders).toEqual([]);
    const kept = cg.preserveStoredOwnedFields([{ id: "r1" }, { id: "zz" }, "junk"], [{ id: "r1", resolution: "build", held: { holders: ["A"] } } as any]) as any[];
    expect(kept[0]).toMatchObject({ resolution: "build", held: { holders: ["A"] } });
    expect(kept[1]).toEqual({ id: "zz" });
    expect(kept[2]).toBe("junk");
  });

  test("the S3 client strips resolution from the save payload", () => {
    expect(read("components/stages/synergy/useSynergyResult.ts")).toContain("gapRows.map(({ resolution: _s5Owned, ...r }) => r)");
  });
});

describe("row hash and round-trip are unchanged by the holders removal", () => {
  const base = cg.normalizeGapRows([{ id: "r", capability: "X", necessity: "essential", held: { status: "partial", holders: ["B", "A"], evidence: "e" }, requiredLevel: "r", currentLevel: "c" }])[0];
  test("legacy holders survive normalize and stay in the hash (version stays v2)", () => {
    expect(base.held.holders).toEqual(["B", "A"]);
    expect(lk.capabilityRowHash(base).startsWith("v2:")).toBe(true);
    const same = { ...base, held: { ...base.held, holders: ["A", "B"] } };
    expect(lk.capabilityRowHash(same)).toBe(lk.capabilityRowHash(base));
    const dropped = { ...base, held: { ...base.held, holders: [] } };
    expect(lk.capabilityRowHash(dropped)).not.toBe(lk.capabilityRowHash(base));
  });
  test("column order constant ends with the evidence column", () => {
    expect([...cg.CAPABILITY_COLUMN_ORDER]).toEqual(["capability", "necessity", "requiredLevel", "heldStatus", "currentLevel", "evidence"]);
  });
});

describe("S3 UI has no 해소 힌트 and no holders inputs", () => {
  test("SynergyLinkageTab", () => {
    const src = read("components/stages/synergy/SynergyLinkageTab.tsx");
    for (const k of ["해소 힌트", "RESOLUTION_LABEL", "GapResolution", "보유 주체", "holderText"]) expect(src).not.toContain(k);
    expect(src).not.toContain("resolution:");
    expect(src).toContain('<th scope="col">보유 수준</th><th scope="col">보유 근거</th>');
    expect(src).toContain("<HeldEvidenceButton");
    expect(src).toContain("legacyHolders={r.held.holders}");
  });
  test("no UI surface prints a 주체 label or edits holders", () => {
    for (const f of ["components/stages/synergy/SynergyLinkageTab.tsx", "components/stages/CapabilityJudgementTable.tsx", "components/stages/CapabilityHeldDialog.tsx", "components/stages/synergy/HoldingRecheckDialog.tsx"]) {
      if (!existsSync(join(ROOT, "app/web-next", f))) continue;
      expect(read(f)).not.toContain("보유 주체·근거");
    }
    const dlg = read("components/stages/CapabilityHeldDialog.tsx");
    expect(dlg).toContain("기존 보유 주체:");
    expect(dlg).not.toMatch(/setHolder|onChange=\{\(e\) => setHolder/);
    const eval_ = read("components/stages/route-decision/EvalTab.tsx");
    expect(eval_).toContain("기존 보유 주체:");
    expect(eval_).not.toContain("해소 힌트");
  });
  test("legacy caption renders only with holders (button + caption helper)", async () => {
    const { legacyHoldersCaption } = await import("../../app/web-next/components/stages/CapabilityHeldDialog.tsx");
    expect(legacyHoldersCaption([])).toBe("");
    expect(legacyHoldersCaption(["레인보우로보틱스"])).toBe("기존 보유 주체: 레인보우로보틱스");
  });
});
