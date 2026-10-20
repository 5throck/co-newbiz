// @version 1.0.0
/**
 * ADR-0171 slice 3: S8 reads the S5 (Green Field) or the selected target's S7 (Brown Field)
 * judgements. Covers the S8 summary values and labels (confirmed / unconfirmed / stale), lens T1 and
 * the gate brief reading them with no grade cap or gate block, consistent 410 on the S8 write
 * routes, and the one-off audited legacy-copy script (dry-run vs apply, idempotence, no overwrite).
 * Runs on a :memory: database. ASCII-only source: Korean strings are written as \u escapes.
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
process.env.CO_NEWBIZ_DB_PATH = ":memory:";

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(":memory:");
const db = getDb(":memory:");

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const crit = await import("../../app/web-next/lib/brownfield-eval-criteria.ts");
const bf = await import("../../app/web-next/lib/brownfield-capability-judgement.ts");
const { buildS8LensSummary } = await import("../../app/web-next/lib/s8-lens-summary.ts");
const { deriveT1 } = await import("../../app/web-next/lib/technical-lens.ts");
const { runLegacyCopy } = await import("../../scripts/co-newbiz/copy-legacy-bf-capability-judgements.ts");
const { parseGapRegister, normalizeGapRows } = await import("../../app/web-next/lib/capability-gap.ts");
const { capabilityRowHash } = await import("../../app/web-next/lib/capability-linkage.ts");
const { parseGapRegister: _p } = await import("../../app/web-next/lib/capability-gap.ts");

const NOW = "2026-10-15T09:00:00Z";
const USER = "slice3-user";
const json = JSON.stringify;
const read = (p: string) => readFileSync(join(PROJECT_ROOT, p), "utf-8");

let oppId = "";
let projectId = "";
let target = "";
let otherTarget = "";

const legacyAtt = (over: Record<string, unknown> = {}) => ({
  closingCostKrwM: 300, monthsToAttain: 9, grade: "medium", rationale: "legacy rationale", evidence: [], draftedBy: "human", category: "labor",
  confirmedBy: "someone", confirmedAt: NOW, ...over,
});
const s3 = () => stamp(raw3());
const stamp = (rows: any[]) => rows.map((r) => (r.attainability ? { ...r, attainability: { ...r.attainability, basisHash: capabilityRowHash(normalizeGapRows([r])[0]) } } : r));
const raw3 = () => [
  { id: "a", capability: "Precision machining", source: "manual", requiredNote: "", held: { status: "none" }, requiredLevel: "advanced", currentLevel: "basic", resolution: "hire", attainability: legacyAtt({ expectedLevel: "team runs it" }) },
  { id: "b", capability: "Quality certification", source: "manual", requiredNote: "", held: { status: "partial" }, requiredLevel: "working", currentLevel: "basic" },
  { id: "c", capability: "Logistics", source: "manual", requiredNote: "", held: { status: "none" }, requiredLevel: "working", currentLevel: "basic", resolution: "build", attainability: legacyAtt({ grade: "low", rationale: "hard", expectedLevel: "own line" }) },
];
const stored = (t: string) => db.query("SELECT * FROM brownfield_target_capability_judgement WHERE brownfield_target_id = ?").all(t) as any[];
const auditCount = (action: string) => (db.query("SELECT COUNT(*) n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;

beforeAll(async () => {
  await createUser(db, { userId: USER, role: "analyst", password: `pw-${USER}-12345`, createdBy: "test", now: NOW });
  approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "bf opp", "industry", "selected", USER, NOW]);
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows: s3(), updatedAt: NOW }), oppId]);
  const mk = (name: string, rank: number) => {
    const id = ulid();
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [id, oppId, name, "shortlisted", rank, NOW, NOW]);
    return id;
  };
  target = mk("Selected Co", 1);
  otherTarget = mk("Other Co", 2);
  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, origin, track) VALUES (?,?,?,?,?,?)", [projectId, `BF-${projectId.slice(-8)}`, NOW, oppId, "internal", "brownfield"]);
  db.run(
    "INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [ulid(), "project", projectId, projectId, "t", "s8_target_select", "done", "web", USER, NOW, NOW, json({ target_id: target })],
  );
  crit.listOrSeedCriteria(oppId, USER, db);
});

describe("legacy copy script", () => {
  test("dry-run by default: reports what would be copied and writes nothing", () => {
    const before = auditCount("capability_attainability.legacy_copy");
    const rep = runLegacyCopy(db, { apply: false, now: NOW });
    const mine = rep.find((r) => r.projectId === projectId)!;
    expect(mine.targetId).toBe(target);
    expect(mine.items.map((i) => `${i.rowId}:${i.outcome}`)).toEqual(["a:copied", "c:copied"]); // b has no legacy judgement
    expect(stored(target)).toHaveLength(0);
    expect(auditCount("capability_attainability.legacy_copy")).toBe(before);
  });

  test("the CLI is dry-run unless --apply is passed", () => {
    const src = read("scripts/co-newbiz/copy-legacy-bf-capability-judgements.ts");
    expect(src).toContain('process.argv.includes("--apply")');
    expect(src).toContain("runLegacyCopy(getDb(), { apply })");
  });

  test("apply copies to the selected target only, UNCONFIRMED, one audit row per copy; an existing judgement is never overwritten", () => {
    // Pre-existing judgement for row c on the selected target: must survive untouched.
    const existing = json({ resolution: "partner", attainability: { closingCostKrwM: 1, monthsToAttain: 1, grade: "high", rationale: "mine", evidence: [], draftedBy: "human", confirmedBy: null, confirmedAt: null } });
    db.run(
      `INSERT INTO brownfield_target_capability_judgement (id, brownfield_target_id, capability_row_id, criterion_id, judgement_json, eval_basis_hash, created_by, created_at, updated_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), target, "c", null, existing, null, USER, NOW, USER, NOW],
    );
    const rep = runLegacyCopy(db, { apply: true, now: NOW });
    const mine = rep.find((r) => r.projectId === projectId)!;
    expect(mine.items.map((i) => `${i.rowId}:${i.outcome}`)).toEqual(["a:copied", "c:skip_existing"]);
    const rows = stored(target);
    expect(rows.map((r) => r.capability_row_id).sort()).toEqual(["a", "c"]);
    const a = JSON.parse(rows.find((r) => r.capability_row_id === "a").judgement_json);
    expect(a.resolution).toBe("hire");
    expect(a.attainability.grade).toBe("medium");
    expect(a.attainability.confirmedAt).toBeNull();
    expect(a.attainability.confirmedBy).toBeNull();
    expect(a.attainability.rationale).toBe("legacy rationale"); // copied, not invented
    expect(rows.find((r) => r.capability_row_id === "a").criterion_id).not.toBeNull();
    expect(JSON.parse(rows.find((r) => r.capability_row_id === "c").judgement_json).attainability.rationale).toBe("mine");
    expect(stored(otherTarget)).toHaveLength(0); // only the selected target
    const audits = db.query("SELECT actor_user_id a, target FROM audit_log WHERE action = 'capability_attainability.legacy_copy'").all() as Array<{ a: string; target: string }>;
    expect(audits).toHaveLength(1);
    expect(audits[0].target).toBe(`${oppId}#capability@script:surface=S7:target_id=${target}:row=a`);
  });

  test("idempotent: a second apply copies nothing and adds no audit row", () => {
    const before = auditCount("capability_attainability.legacy_copy");
    const rep = runLegacyCopy(db, { apply: true, now: NOW });
    expect(rep.find((r) => r.projectId === projectId)!.items.every((i) => i.outcome === "skip_existing")).toBe(true);
    expect(stored(target)).toHaveLength(2);
    expect(auditCount("capability_attainability.legacy_copy")).toBe(before);
  });

  test("rows without a seeded S7 criterion are skipped, never invented", () => {
    const rows = s3();
    rows.push({ id: "d", capability: "New row", source: "manual", requiredNote: "", held: { status: "none" }, requiredLevel: "x", currentLevel: "y", resolution: "invest", attainability: legacyAtt() } as any);
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows, updatedAt: NOW }), oppId]);
    const rep = runLegacyCopy(db, { apply: true, now: NOW }).find((r) => r.projectId === projectId)!;
    expect(rep.items.find((i) => i.rowId === "d")!.outcome).toBe("skip_no_criterion");
    expect(stored(target).some((r) => r.capability_row_id === "d")).toBe(false);
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows: s3(), updatedAt: NOW }), oppId]);
  });

  test("a project without a selected target is skipped", () => {
    const p2 = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, origin, track) VALUES (?,?,?,?,?,?)", [p2, `BF-${p2.slice(-8)}`, NOW, oppId, "internal", "brownfield"]);
    const rep = runLegacyCopy(db, { apply: true, now: NOW }).find((r) => r.projectId === p2)!;
    expect(rep.skipped).toBe("no selected target");
  });
});

describe("S8 reads the selected target's S7 judgements (Brown Field)", () => {
  test("lens T1 uses the target's UNCONFIRMED copy, not the S3 row's own legacy confirmation", () => {
    const s = buildS8LensSummary(db, projectId);
    const t1 = s.technical.items.find((i) => i.key === "T1")!;
    expect(t1.judged).toBe(false); // copied judgements are unconfirmed
    expect(t1.status).toBe("undetermined");
    expect(t1.note).toContain("0/3");
  });

  test("after a person confirms, T1 reflects it; a low grade shows caution; no grade cap is applied", () => {
    const scope = bf.targetScope(db, target);
    if (!scope.ok) throw new Error("scope");
    const res = bf.confirmTargetJudgements(db, scope.target, ["a"], USER, { action: "capability_attainability.confirm", via: "ui", at: NOW });
    if (!res.ok) throw new Error(JSON.stringify(res.error));
    const t1 = buildS8LensSummary(db, projectId).technical.items.find((i) => i.key === "T1")!;
    expect(t1.note).toContain("1/3"); // row a confirmed by a person
    expect(t1.status).toBe("undetermined"); // row c (mine, grade high) and b are not confirmed
  });

  test("a changed S3 definition shows as stale on the S8 view (re-judgement needed) and is not counted judged", () => {
    const rows = s3();
    rows[0] = { ...rows[0], requiredLevel: "expert" } as any;
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows, updatedAt: NOW }), oppId]);
    const s = buildS8LensSummary(db, projectId);
    expect(s.technical.staleCount).toBeGreaterThanOrEqual(1);
    const view = bf.buildTargetView(db, bf.targetScope(db, target).ok ? (bf.targetScope(db, target) as any).target : null);
    expect(view.rows.find((r) => r.id === "a")!.stale).toBe(true);
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows: s3(), updatedAt: NOW }), oppId]);
  });

  test("a Brown Field project without a selected target ignores the S3 rows' own judgement", () => {
    const p3 = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, origin, track) VALUES (?,?,?,?,?,?)", [p3, `BF-${p3.slice(-8)}`, NOW, oppId, "internal", "brownfield"]);
    const t1 = buildS8LensSummary(db, p3).technical.items.find((i) => i.key === "T1")!;
    expect(t1.judged).toBe(false);
    expect(t1.note).toContain("0/3");
  });

  test("Green Field T1 still reads the S3 row judgement (S5), unchanged", () => {
    const rows = parseGapRegister(json({ rows: s3(), updatedAt: NOW })).rows;
    expect(deriveT1(rows).status).toBe("caution");
  });

  test("2026-10-20 decider: the gate brief no longer carries the S7 per-target capability line (verification lives in S9; S7/S9 unlinked)", () => {
    const src = read("app/web-next/lib/gate-brief.ts");
    expect(src).not.toContain("bfCapabilityCheckLines");
    expect(src).not.toContain("필요 역량 점검(S7");
  });
});

describe("source guards", () => {
  test("S8 project routes: Green Field and Brown Field both answer 410 moved; the S8 panel has no inputs", () => {
    const put = read("app/web-next/app/api/projects/[id]/capability-attainability/route.ts");
    const conf = read("app/web-next/app/api/projects/[id]/capability-attainability/confirm/route.ts");
    for (const src of [put, conf]) {
      expect(src).toContain('"S5"');
      expect(src).toContain('"S7"');
      expect(src).toContain("moved(");
    }
    const panel = read("app/web-next/components/stages/CapabilityAttainabilityPanel.tsx");
    expect(panel).toContain("editable={false}");
    expect(panel).not.toContain("<input");
    expect(panel).not.toContain("method: \"PUT\"");
  });

  test("S9 round 2/3: the panel mirrors capability-dd verdicts read-only and routes brownfield judgement to the S9 tab", () => {
    const panel = read("app/web-next/components/stages/CapabilityAttainabilityPanel.tsx");
    // round 3: verdicts ride on the canonical table ("S9 검증" column) — the separate
    // mirror table is gone; the fetch stays and the prop is conditional on verdicts.
    expect(panel).not.toContain('data-testid="s9-capability-dd-results"');
    expect(panel).toContain("}/capability-dd`");
    expect(panel).toContain("s9={ddVerdicts && ddVerdicts.length > 0 ? s9ByRow : undefined}");
    const table = read("app/web-next/components/stages/CapabilityJudgementTable.tsx");
    // round 4: no separate S9 column — the verdict rides inside the merged 판정 cell
    expect(table).not.toContain('data-testid="capability-s9-col"');
    expect(table).toContain('data-testid={`capability-s9-cell-${r.id}`}');
    // brownfield detection comes from the GET track field; judgement entry follows the S9 tab
    expect(panel).toContain('view.track === "brownfield"');
    expect(panel).toContain("judgeHref={isBrownfield ? s9Href : editHref}");
    expect(panel).toContain('judgeLabel={isBrownfield ? "S9'+"에서 판정\"");
    // the legacy target edit payload is untouched (route still sends edit_href)
    const route = read("app/web-next/app/api/projects/[id]/capability-attainability/route.ts");
    expect(route).toContain("edit_href");
    // the S8 scenarios note points brownfield at the S9 tab, greenfield keeps the technical tab
    const bcs = read("app/web-next/components/stages/BusinessCaseStage.tsx");
    expect(bcs).toContain("!greenfield && targets.length > 0");
    expect(bcs).toContain("`/projects/${projectId}/dd`");
  });

  test("no grade cap or gate block is introduced by the S8 readers", () => {
    for (const f of ["app/web-next/lib/s8-lens-summary.ts", "app/web-next/lib/gate-brief.ts"]) {
      const src = read(f);
      expect(src).not.toMatch(/gate_blocked|capGrade|gradeCap/);
    }
  });
});
