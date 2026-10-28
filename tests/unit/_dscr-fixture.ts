// @version 1.0.0
// Shared fixture for tests that need a project with debt and an adopted S8 case, so the
// deterministic downside DSCR (app/web-next/lib/covenant-dscr.ts, D1 2026-10-28) is computable
// on a scratch DB. Not a test file (no .test.ts suffix). The caller owns the DB lifecycle; the
// generator reads the same singleton connection the test opened.
import { ulid } from "../../db/lib/ulid.ts";
import { caseInputsForProject, deterministicCaseYearTable } from "../../app/web-next/lib/business-case-generator.ts";

type Db = { run: (sql: string, params?: unknown[]) => unknown; query: (sql: string) => { get: (...a: unknown[]) => unknown } };

const NOW = "2026-10-28T09:00:00.000Z";

/**
 * Adopt a valuation model for the project (process_run s8_case_adopt). `downside` controls whether
 * the project has a downside case (valuation_simulation rows with scenario = downside). Returns the model id.
 */
/** The frozen snapshot the generator would write for the project's CURRENT inputs (deterministic_flows + drivers). */
export function frozenSnapshot(projectId: string, scenario: "downside" | "base", scale = 1): string {
  const t = deterministicCaseYearTable(caseInputsForProject(projectId), scenario);
  return JSON.stringify({
    cases: [{ case_id: `${scenario}:market_forward`, drivers: { revenue_y1: { dist: "constant", value: 1 } } }],
    deterministic_flows: { version: 1, horizon: t.horizon, exit_value: t.exitValue, years: t.rows.filter((r) => r.year >= 1).map((r) => ({ year: r.year, fcf: r.fcf * scale })) },
  });
}

/** `baseSnapshot` / `downsideSnapshot`: omitted = frozen from the current inputs; `null` = a legacy model without frozen flows. */
export function adoptCase(db: Db, projectId: string, opts: { downside?: boolean; adoptedAt?: string; baseSnapshot?: string | null; downsideSnapshot?: string | null; downsideOffsetMs?: number } = {}): string {
  const mk = (scenario: "base" | "downside", createdAt: string, snapshot: string | null) => {
    const id = ulid();
    db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,'valuation','fixture',5,'test',?,?)", [id, projectId, createdAt, snapshot]);
    db.run("INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at) VALUES (?,?,?,?,'p50',100,0.1,NULL,?)", [ulid(), projectId, id, scenario, createdAt]);
    return id;
  };
  const model = mk("base", NOW, opts.baseSnapshot === undefined ? frozenSnapshot(projectId, "base") : opts.baseSnapshot);
  if (opts.downside !== false) mk("downside", new Date(Date.parse(NOW) + (opts.downsideOffsetMs ?? 1000)).toISOString(), opts.downsideSnapshot === undefined ? frozenSnapshot(projectId, "downside") : opts.downsideSnapshot);
  const at = opts.adoptedAt ?? NOW;
  db.run(
    "INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,'t','s8_case_adopt','done','human','t',?,?,?)",
    [ulid(), "project", projectId, projectId, at, at, JSON.stringify({ model_id: model })],
  );
  return model;
}

/** Per-year CFADS (years 1..H, exit value excluded) the check will see for a scenario. */
export function cfadsOf(projectId: string, scenario: "downside" | "base"): number[] {
  const t = deterministicCaseYearTable(caseInputsForProject(projectId), scenario);
  return t.rows.filter((r) => r.year >= 1).map((r) => (r.year === t.horizon ? r.fcf - t.exitValue : r.fcf));
}

/**
 * Register one annuity loan (5-year tenor, 5 % p.a.) sized so the MINIMUM downside DSCR of the project
 * lands on `targetMinDscr`. `covenant` is written to covenant_json verbatim. Returns the debt id.
 */
export function addDebtForMinDscr(
  db: Db,
  projectId: string,
  targetMinDscr: number,
  extra: { covenant?: string | null; amortization?: string | null; maturity?: string | null; rate?: number; lender?: string } = {},
): string {
  const cfads = cfadsOf(projectId, "downside");
  const minCf = Math.min(...cfads);
  if (!(minCf > 0)) throw new Error(`fixture needs positive downside CFADS (min ${minCf})`);
  const service = minCf / targetMinDscr;
  const r = (extra.rate ?? 5) / 100;
  const principal = (service * (1 - Math.pow(1 + r, -5))) / r;
  const id = ulid();
  db.run(
    "INSERT INTO debt_instrument (id, project_id, lender, principal, rate_type, rate, maturity, amortization, covenant_json) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, projectId, extra.lender ?? "Bank A", principal, "fixed", extra.rate ?? 5, extra.maturity === undefined ? "5년" : extra.maturity, extra.amortization === undefined ? "annuity" : extra.amortization, extra.covenant ?? null],
  );
  return id;
}
