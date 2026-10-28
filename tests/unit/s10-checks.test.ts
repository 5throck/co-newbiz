// @version 1.0.0
// ADR-0187 P3 (finding M1): S10 checks beyond sources = uses - uses reconcile to the
// S8 adopted investment (+/-5%), downside DSCR headroom (>= 1.3x), funding evidence
// on every source. Unit level (scratch SQLite) plus the engine integration on the
// seeded demo deals.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-s10-checks.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { ulid } = await import("../../db/lib/ulid.ts");
const s10 = await import("../../app/web-next/lib/s10-checks.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { blocker } = await import("../../app/web-next/lib/process-blocker-keys.ts");
const { seedS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { computeDownsideDscr, debtServiceByYear, parseAmortization, parseDeclaredCovenants, parseTenorYears } = await import("../../app/web-next/lib/covenant-dscr.ts");
const { adoptCase: adoptFixtureCase, addDebtForMinDscr, cfadsOf, frozenSnapshot: frozenSnapshotOf } = await import("./_dscr-fixture.ts");

const NOW = new Date().toISOString();
const OLD = "2026-10-01T00:00:00.000Z";

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function project(createdAt = NOW): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `S10-${id.slice(-8)}`, createdAt]);
  return id;
}
function fin(projectId: string, kind: "source" | "use", amount: number, evidence?: { kind: string; ref: string }, name = `${kind}-${ulid().slice(-4)}`) {
  db.run(
    "INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, created_by, created_at, evidence_kind, evidence_ref) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), projectId, kind, name, amount, "t", NOW, evidence?.kind ?? null, evidence?.ref ?? null],
  );
}
/** An adopted case whose single capex line spends `capex` (KRW millions) once (start_year 0). */
function adoptCase(projectId: string, capex: number | null, unit: string | null = "KRW_M"): string {
  const model = ulid();
  db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,'investment_return','m',5,'t',?)", [model, projectId, NOW]);
  if (capex !== null) {
    db.run(
      "INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, created_by, created_at, unit) VALUES (?,?,'capex','c',?,0,0,'t',?,?)",
      [ulid(), model, capex, NOW, unit],
    );
  }
  db.run(
    "INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,'t','s8_case_adopt','done','human','t',?,?,?)",
    [ulid(), "project", projectId, projectId, NOW, NOW, JSON.stringify({ model_id: model })],
  );
  return model;
}
describe("D2 thresholds are named constants with their owner-confirmed starting values", () => {
  test("values", () => {
    expect(s10.S10_USES_RECONCILIATION_TOLERANCE).toBe(0.05);
    expect(s10.S10_MIN_DOWNSIDE_DSCR).toBe(1.3);
    expect(s10.ADR_0187_P3_PREDICATE_DATE).toBe("2026-10-28");
  });
});

describe("(a) uses reconcile to the S8 adopted investment (+/-5%)", () => {
  test("boundary: exactly 5% passes, just over blocks (both directions)", () => {
    for (const [uses, blocks] of [[1000, false], [1050, false], [950, false], [1051, true], [949, true], [1100, true], [900, true]] as const) {
      const p = project();
      adoptCase(p, 1000);
      fin(p, "use", uses);
      const r = s10.s10UsesReconciliation(db, p);
      expect(r.missing.length > 0).toBe(blocks);
      expect(r.advisories).toEqual([]);
      if (blocks) {
        expect(r.missing).toEqual([blocker("s10.uses_reconcile_adopted_investment")]);
        expect(r.blockers[0]).toContain("허용 오차 ±5% 초과");
      }
    }
  });
  test("not derivable: no adopted case / no capex lines / unit not KRW_M / non-positive -> advisory only, never a block, never a silent pass", () => {
    const cases: Array<[string, (p: string) => void]> = [
      ["채택 Business Case가 없습니다", () => {}],
      ["capex 행이 없습니다", (p) => void adoptCase(p, null)],
      ["KRW_M으로 명시되어 있지 않습니다", (p) => void adoptCase(p, 1000, null)],
      ["양수가 아닙니다", (p) => void adoptCase(p, -500)],
    ];
    for (const [why, setup] of cases) {
      const p = project();
      setup(p);
      fin(p, "use", 777);
      const r = s10.s10UsesReconciliation(db, p);
      expect(r.missing).toEqual([]);
      expect(r.blockers).toEqual([]);
      expect(r.advisories.length).toBe(1);
      expect(r.advisories[0]).toContain(why);
      expect(r.advisories[0]).toContain("777");
    }
  });
  test("an empty plan is the balance blocker's job, not this check's", () => {
    const p = project();
    adoptCase(p, 1000);
    expect(s10.s10UsesReconciliation(db, p)).toEqual({ blockers: [], missing: [], advisories: [] });
  });
});

/** A project with an adopted case (downside exists unless `downside: false`). */
function adoptedProject(opts: { downside?: boolean } = {}): string {
  const p = project();
  adoptFixtureCase(db, p, opts);
  return p;
}
const addRawDebt = (projectId: string, cols: { principal?: number; rate?: number; maturity?: string | null; amortization?: string | null; covenant?: string | null; lender?: string } = {}) =>
  db.run(
    "INSERT INTO debt_instrument (id, project_id, lender, principal, rate_type, rate, maturity, amortization, covenant_json) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), projectId, cols.lender ?? "Bank A", cols.principal ?? 100, "fixed", cols.rate ?? 5, cols.maturity === undefined ? "5년" : cols.maturity, cols.amortization === undefined ? "annuity" : cols.amortization, cols.covenant ?? null],
  );

describe("(b) downside covenant headroom (DSCR >= 1.3x) - computed deterministically (D1, 2026-10-28)", () => {
  test("no debt: not applicable (and no adopted case is needed)", () => {
    expect(s10.s10CovenantHeadroom(db, project())).toEqual({ blockers: [], missing: [], advisories: [] });
  });

  test("PASS: debt whose downside minimum DSCR clears 1.3x does not block", () => {
    const p = adoptedProject();
    addDebtForMinDscr(db, p, 1.6);
    const r = s10.s10CovenantHeadroom(db, p);
    expect(r.missing).toEqual([]);
    expect(r.blockers).toEqual([]);
    expect(r.advisories).toEqual([]);
    const rep = computeDownsideDscr(db, p);
    expect(rep).toMatchObject({ status: "computed", scenario: "downside", fallback_to_base: false });
    expect(rep.min_dscr).toBeCloseTo(1.6, 2);
  });

  test("boundary: minimum projected DSCR of exactly 1.3 passes, just below blocks (stable blocker label)", () => {
    const ok = adoptedProject();
    addDebtForMinDscr(db, ok, 1.3);
    expect(s10.s10CovenantHeadroom(db, ok).missing).toEqual([]);
    const low = adoptedProject();
    addDebtForMinDscr(db, low, 1.29);
    const r = s10.s10CovenantHeadroom(db, low);
    expect(r.missing).toEqual([blocker("s10.downside_covenant_headroom")]);
    expect(r.blockers[0]).toContain("기준 1.3배 미만");
    expect(r.blockers[0]).toContain("다운사이드");
  });

  test("FAIL: a downside breach of the declared DSCR covenant blocks even when the 1.3x floor holds", () => {
    const p = adoptedProject();
    addDebtForMinDscr(db, p, 1.4, { covenant: "DSCR >= 1.5" });
    const r = s10.s10CovenantHeadroom(db, p);
    expect(r.missing).toEqual([blocker("s10.downside_covenant_headroom")]);
    expect(r.blockers[0]).toContain("커버넌트가 위반");
    expect(r.blockers[0]).toContain("1개 기간");
    // the same debt with a looser covenant passes
    const q = adoptedProject();
    addDebtForMinDscr(db, q, 1.4, { covenant: JSON.stringify({ DSCR_min: 1.2 }) });
    expect(s10.s10CovenantHeadroom(db, q).missing).toEqual([]);
  });

  test("judged on the DOWNSIDE, not the base: debt that clears the base but not the downside blocks", () => {
    const p = adoptedProject();
    addDebtForMinDscr(db, p, 1.1); // sized on downside CFADS
    const base = Math.min(...cfadsOf(p, "base"));
    const down = Math.min(...cfadsOf(p, "downside"));
    expect(base).toBeGreaterThan(down);
    expect(computeDownsideDscr(db, p).min_dscr).toBeCloseTo(1.1, 2);
    expect(s10.s10CovenantHeadroom(db, p).missing.length).toBe(1);
  });

  test("base fallback: no downside case -> computed on the base scenario and an advisory says so (never silent)", () => {
    const p = adoptedProject({ downside: false });
    addDebtForMinDscr(db, p, 1.5); // sized on downside CFADS; base cash flows are higher
    const rep = computeDownsideDscr(db, p);
    expect(rep).toMatchObject({ status: "computed", scenario: "base", fallback_to_base: true });
    const service = Math.min(...cfadsOf(p, "downside")) / 1.5;
    expect(rep.min_dscr).toBeCloseTo(Math.min(...cfadsOf(p, "base")) / service, 2);
    const r = s10.s10CovenantHeadroom(db, p);
    expect(r.missing).toEqual([]);
    expect(r.advisories.some((a) => a.startsWith("[권고·비차단]") && a.includes("다운사이드 케이스가 없어 기준(base)"))).toBe(true);
  });

  test("missing inputs block and NAME the input (no adopted case; maturity; amortization; rate; principal)", () => {
    const noCase = project();
    addRawDebt(noCase);
    expect(s10.s10CovenantHeadroom(db, noCase).blockers[0]).toContain("S8 채택 Business Case");
    const cases: Array<[Parameters<typeof addRawDebt>[1], string]> = [
      [{ maturity: null }, "만기/상환기간(maturity)"],
      [{ maturity: "someday" }, "maturity='someday'"],
      [{ amortization: null }, "상환방식(amortization)"],
      [{ amortization: "weird" }, "amortization='weird'"],
      [{ rate: 0 }, "금리(rate"],
      [{ principal: 0 }, "원금(principal)"],
    ];
    for (const [cols, needle] of cases) {
      const p = adoptedProject();
      addRawDebt(p, { ...cols, lender: "Kookmin" });
      const r = s10.s10CovenantHeadroom(db, p);
      expect(r.missing).toEqual([blocker("s10.downside_covenant_headroom")]);
      expect(r.blockers[0]).toContain(needle);
      expect(r.blockers[0]).toContain("Kookmin");
    }
  });

  test("a bullet loan repaid inside the plan horizon fails its maturity year; a date maturity is measured from the adoption date", () => {
    const p = adoptedProject();
    addRawDebt(p, { principal: 200, amortization: "원금 만기일시", maturity: "2031-10" }); // adoption 2026-10-28 -> 4.93y -> floor 4
    const rep = computeDownsideDscr(db, p);
    expect(rep.status).toBe("computed");
    expect(rep.periods.find((x) => x.year === 4)!.debt_service).toBeGreaterThan(200);
    expect(s10.s10CovenantHeadroom(db, p).missing.length).toBe(1);
    const before = adoptedProject();
    addRawDebt(before, { maturity: "2026-01" }); // not after the adoption date
    expect(computeDownsideDscr(db, before).missing_inputs.join()).toContain("maturity='2026-01'");
  });
});

describe("deterministic DSCR building blocks", () => {
  test("tenor: a bare number / 5y / 5년 is a tenor; dates are measured from the reference, rounded down", () => {
    const ref = "2026-10-28T00:00:00.000Z";
    expect(parseTenorYears("5", ref)).toBe(5);
    expect(parseTenorYears("7y", ref)).toBe(7);
    expect(parseTenorYears("3년", ref)).toBe(3);
    expect(parseTenorYears("2031-10", ref)).toBe(4); // 4.93y rounded DOWN (conservative)
    expect(parseTenorYears("5.9", ref)).toBe(5);
    expect(parseTenorYears("0.5", ref)).toBe(1);
    expect(parseTenorYears("2031", ref)).toBe(5); // year-only = end of that year, 5.18y -> 5
    expect(parseTenorYears("2026-06", ref)).toBeNull();
    expect(parseTenorYears("soon", ref)).toBeNull();
    expect(parseTenorYears("2031-10", null)).toBeNull();
  });
  test("amortization synonyms", () => {
    expect(parseAmortization("annuity")).toBe("annuity");
    expect(parseAmortization("원리금균등")).toBe("annuity");
    expect(parseAmortization("equal_principal")).toBe("equal_principal");
    expect(parseAmortization("원금균등 분할상환")).toBe("equal_principal");
    expect(parseAmortization("만기일시")).toBe("bullet");
    expect(parseAmortization("balloon")).toBe("bullet");
    expect(parseAmortization("???")).toBeNull();
  });
  test("schedules: annuity is level, equal-principal declines, bullet repays at maturity; balances clear", () => {
    const a = debtServiceByYear(100, 5, 5, "annuity");
    expect(new Set(a.map((x) => Math.round(x * 1e6))).size).toBe(1);
    expect(a[0]).toBeCloseTo((100 * 0.05) / (1 - Math.pow(1.05, -5)), 6);
    const e = debtServiceByYear(100, 5, 4, "equal_principal");
    expect(e[0]).toBeCloseTo(25 + 5, 6);
    expect(e[3]).toBeCloseTo(25 + 1.25, 6);
    const b = debtServiceByYear(100, 5, 3, "bullet");
    expect(b).toEqual([5, 5, 105]);
  });
  test("covenant parsing: text and JSON forms; only DSCR is computed, the rest listed as untested", () => {
    expect(parseDeclaredCovenants("DSCR >= 1.3 · NetLev <= 3.5x")).toEqual([
      { key: "DSCR", direction: "min", value: 1.3 }, { key: "NetLev", direction: "max", value: 3.5 },
    ]);
    expect(parseDeclaredCovenants(JSON.stringify({ DSCR_min: 1.3, NetLev_max: 3.5 }))).toEqual([
      { key: "DSCR", direction: "min", value: 1.3 }, { key: "NetLev", direction: "max", value: 3.5 },
    ]);
    expect(parseDeclaredCovenants(null)).toEqual([]);
  });
});

describe("(c) funding evidence on every source", () => {
  test("every source needs evidence_kind and a non-blank evidence_ref", () => {
    const p = project();
    fin(p, "source", 500, { kind: "commitment_letter", ref: "doc-1" }, "Bank");
    fin(p, "source", 500, undefined, "Parent");
    fin(p, "source", 100, { kind: "internal_approval", ref: "   " }, "Fund");
    fin(p, "use", 1100);
    const r = s10.s10FundingEvidence(db, p);
    expect(r.missing).toEqual([blocker("s10.funding_evidence")]);
    expect(r.blockers[0]).toContain("2건");
    expect(r.blockers[0]).toContain("Parent");
    const ok = project();
    fin(ok, "source", 500, { kind: "term_sheet", ref: "ts" });
    fin(ok, "use", 500);
    expect(s10.s10FundingEvidence(db, ok)).toEqual({ blockers: [], missing: [], advisories: [] });
  });
});

describe("engine integration (flow.spec 2.16.0 S10 completionCriteria 2-4)", () => {
  test("debt on the seeded brownfield deal: missing terms re-open S10 naming the input; sized terms re-complete it (brownfield per-target CFADS path)", async () => {
    const bf = await seedS1ToS12Demo();
    expect(evaluateProcess({ type: "project", id: bf.projectId }).completedStages).toContain("S10");
    const debtId = ulid();
    db.run("INSERT INTO debt_instrument (id, project_id, lender, principal, rate_type, rate) VALUES (?,?,?,?,?,?)", [debtId, bf.projectId, "Shinhan", 100, "fixed", 5]);
    const open = evaluateProcess({ type: "project", id: bf.projectId });
    expect(open.completedStages).not.toContain("S10");
    expect(open.requiredArtifacts).toContain(blocker("s10.downside_covenant_headroom"));
    expect(open.blockers.join("\n")).toContain("만기/상환기간(maturity)");
    expect(open.blockers.join("\n")).toContain("Shinhan");
    // size the loan on this deal's own downside cash flows: min DSCR 1.5 clears the floor
    const rep0 = (() => {
      db.run("UPDATE debt_instrument SET maturity = '5년', amortization = 'annuity' WHERE id = ?", [debtId]);
      return computeDownsideDscr(db, bf.projectId);
    })();
    expect(rep0.status).toBe("computed");
    const minCf = Math.min(...rep0.periods.map((x) => x.cfads));
    expect(minCf).toBeGreaterThan(0);
    const principal = ((minCf / 1.5) * (1 - Math.pow(1.05, -5))) / 0.05;
    db.run("UPDATE debt_instrument SET principal = ? WHERE id = ?", [principal, debtId]);
    const done = evaluateProcess({ type: "project", id: bf.projectId });
    expect(done.requiredArtifacts).not.toContain(blocker("s10.downside_covenant_headroom"));
    expect(done.completedStages).toContain("S10");
    // an oversized loan fails the 1.3x floor again
    db.run("UPDATE debt_instrument SET principal = ? WHERE id = ?", [principal * 3, debtId]);
    const over = evaluateProcess({ type: "project", id: bf.projectId });
    expect(over.completedStages).not.toContain("S10");
    expect(over.blockers.join("\n")).toContain("기준 1.3배 미만");
      db.run("DELETE FROM debt_instrument WHERE project_id = ?", [bf.projectId]); // leave the shared demo deal as found
  });
  test("the seeded brownfield demo is S10-complete; stripping source evidence re-opens S10 with the stable label", async () => {
    const bf = await seedS1ToS12Demo();
    const clean = evaluateProcess({ type: "project", id: bf.projectId });
    expect(clean.completedStages).toContain("S10");
    db.run("UPDATE financing_sources_uses SET evidence_ref = NULL WHERE project_id = ? AND kind = 'source'", [bf.projectId]);
    const ev = evaluateProcess({ type: "project", id: bf.projectId });
    expect(ev.completedStages).not.toContain("S10");
    expect(ev.currentStage).toBe("S10");
    expect(ev.requiredArtifacts).toContain(blocker("s10.funding_evidence"));
    expect(ev.blockers.join("\n")).toContain("자금 확정성 증빙이 없는 조달원");
  });
  test("a non-derivable adopted investment is an advisory in blockers, not a missing artifact", async () => {
    const bf = await seedS1ToS12Demo(); // demo capex lines carry no unit -> not derivable
    db.run("UPDATE financing_sources_uses SET evidence_ref = NULL WHERE project_id = ? AND kind = 'source' AND name LIKE 'Equity%'", [bf.projectId]);
    const ev = evaluateProcess({ type: "project", id: bf.projectId });
    expect(ev.currentStage).toBe("S10");
    expect(ev.blockers.some((b) => b.includes("대사할 수 없습니다"))).toBe(true);
    expect(ev.requiredArtifacts).not.toContain(blocker("s10.uses_reconcile_adopted_investment"));
  });
  test("grandfathering: a project whose earliest pin and creation predate the P3 date keeps the legacy S10 predicate", async () => {
    const bf = await seedS1ToS12Demo();
    db.run("UPDATE financing_sources_uses SET evidence_ref = NULL, evidence_kind = NULL WHERE project_id = ?", [bf.projectId]);
    expect(evaluateProcess({ type: "project", id: bf.projectId }).completedStages).not.toContain("S10");
    db.run("UPDATE md_project SET created_at = ? WHERE id = ?", [OLD, bf.projectId]);
    db.run("UPDATE project_policy_pin SET pinned_at = ? WHERE project_id = ?", [OLD, bf.projectId]);
    expect(s10.s10M1Grandfathered(db, { id: bf.projectId, created_at: OLD })).toBe(true);
    expect(evaluateProcess({ type: "project", id: bf.projectId }).completedStages).toContain("S10");
  });
});

describe("review hardening (platform-lead AI-2nd): frozen snapshot, same round, rate guard, import guard", () => {
  test("HIGH-1: the verdict is judged on the adopted case's FROZEN flows; changed live inputs only add a stale advisory", () => {
    const p = project();
    adoptFixtureCase(db, p, { downsideSnapshot: undefined });
    addDebtForMinDscr(db, p, 1.5);
    const fresh = computeDownsideDscr(db, p);
    expect(fresh.advisories.some((a) => a.includes("오래됨"))).toBe(false);
    // freeze HALVED downside flows: the live inputs no longer match, the snapshot rules
    const q = project();
    adoptFixtureCase(db, q, { downsideSnapshot: frozenSnapshotOf(q, "downside", 0.5) });
    addDebtForMinDscr(db, q, 1.5);
    const stale = computeDownsideDscr(db, q);
    expect(stale.min_dscr).toBeCloseTo(0.75, 2);
    expect(stale.advisories.some((a) => a.includes("채택 케이스가 오래됨"))).toBe(true);
    expect(s10.s10CovenantHeadroom(db, q).missing.length).toBe(1);
    expect(stale.evidence).toMatch(/^case=\w+;scenario=downside;source_model=\w+;inputs=[0-9a-f]{12}$/);
  });
  test("HIGH-1: a legacy model without frozen flows falls back to live inputs and says so", () => {
    const p = project();
    adoptFixtureCase(db, p, { baseSnapshot: null, downsideSnapshot: null });
    addDebtForMinDscr(db, p, 1.5);
    const rep = computeDownsideDscr(db, p);
    expect(rep.status).toBe("computed");
    expect(rep.advisories.some((a) => a.includes("구버전 생성물"))).toBe(true);
  });
  test("MEDIUM-1: a downside from another generation round is not used (base of the round applies, with the fallback advisory)", () => {
    const p = project();
    adoptFixtureCase(db, p, { downsideOffsetMs: 3 * 3600 * 1000 });
    addDebtForMinDscr(db, p, 1.5);
    const rep = computeDownsideDscr(db, p);
    expect(rep).toMatchObject({ scenario: "base", fallback_to_base: true });
  });
  test("MEDIUM-2: a decimal-looking rate (0 < rate < 1) is a missing input, not a 0.05% loan", () => {
    const p = adoptedProject();
    addRawDebt(p, { rate: 0.05 });
    const r = s10.s10CovenantHeadroom(db, p);
    expect(r.blockers[0]).toContain("% 단위");
    expect(computeDownsideDscr(db, p).reason).toBe("missing_input");
  });
  test("MEDIUM-5: no db/lib module imports app/web-next/lib except the sanctioned snapshot-filler -> covenant-dscr", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = `${import.meta.dirname}/../../db/lib`;
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(`${dir}/${f}`, "utf-8");
      for (const m of src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+["']([^"']*web-next\/lib[^"']*)["']/gm)) {
        if (!(f === "snapshot-filler.ts" && m[1].endsWith("app/web-next/lib/covenant-dscr.ts"))) offenders.push(`${f} -> ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
