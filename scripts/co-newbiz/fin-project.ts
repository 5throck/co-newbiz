#!/usr/bin/env bun
// @version 1.0.0
/**
 * fin-project.ts — fin:project (Wave A3): one project's financial rollup as
 * JSON. Read-only aggregate over what already exists:
 *   - business_case_model × business_case_line: per-scenario year-1 net
 *     (revenue − opex − capex) and totals, latest models only
 *   - valuation_simulation: the latest model's P05/P50/P95 NPV rows
 *   - charter baseline (charter_json KPI targets) when present
 * The valuation engine's own DCF stays out of scope — this surfaces the
 * numbers the pipeline already produces.
 */

import { getDb } from "../../db/client.ts";

export interface ProjectFinancialRollup {
  projectId: string;
  projectName: string | null;
  models: Array<{
    id: string;
    name: string;
    createdAt: string;
    year1: { revenue: number; opex: number; capex: number; net: number };
    horizonYears: number | null;
  }>;
  simulations: Array<{ scenario: string; p05: number | null; p50: number | null; p95: number | null }>;
  charterKpis: Array<{ key: string; target: unknown }> | null;
}

export function projectFinancialRollup(projectId: string): ProjectFinancialRollup {
  const db = getDb();
  const project = db.query("SELECT id, project_name, charter_json FROM md_project WHERE id = ?").get(projectId) as
    | { id: string; project_name: string | null; charter_json: string | null }
    | undefined;
  if (!project) throw new Error(`fin:project: project '${projectId}' not found.`);

  const models = db
    .query(
      `SELECT m.id, m.name, m.created_at, m.horizon_years
       FROM business_case_model m
       WHERE m.project_id = ?
       ORDER BY m.created_at DESC, m.id DESC`,
    )
    .all(projectId) as Array<{ id: string; name: string; created_at: string; horizon_years: number | null }>;

  const rolledModels = models.map((m) => {
    const lines = db
      .query("SELECT category, annual_amount_krw_m FROM business_case_line WHERE model_id = ?")
      .all(m.id) as Array<{ category: string; annual_amount_krw_m: number }>;
    const sum = (cat: string) =>
      lines.filter((l) => l.category === cat).reduce((acc, l) => acc + l.annual_amount_krw_m, 0);
    const revenue = sum("revenue");
    const opex = sum("opex");
    const capex = sum("capex");
    return {
      id: m.id,
      name: m.name,
      createdAt: m.created_at,
      year1: { revenue, opex, capex, net: revenue - opex - capex },
      horizonYears: m.horizon_years,
    };
  });

  const latestModel = rolledModels[0]?.id;
  const simulations = latestModel
    ? (db
        .query(
          `SELECT scenario, percentile, npv_krw_m FROM valuation_simulation WHERE model_id = ? ORDER BY scenario, percentile`,
        )
        .all(latestModel) as Array<{ scenario: string; percentile: string; npv_krw_m: number }>)
        .reduce<Array<{ scenario: string; p05: number | null; p50: number | null; p95: number | null }>>((acc, row) => {
          let bucket = acc.find((b) => b.scenario === row.scenario);
          if (!bucket) {
            bucket = { scenario: row.scenario, p05: null, p50: null, p95: null };
            acc.push(bucket);
          }
          if (row.percentile === "p05") bucket.p05 = row.npv_krw_m;
          if (row.percentile === "p50") bucket.p50 = row.npv_krw_m;
          if (row.percentile === "p95") bucket.p95 = row.npv_krw_m;
          return acc;
        }, [])
    : [];

  let charterKpis: ProjectFinancialRollup["charterKpis"] = null;
  if (project.charter_json) {
    try {
      const charter = JSON.parse(project.charter_json) as { kpis?: Array<{ key: string; target: unknown }> };
      charterKpis = charter.kpis ?? null;
    } catch {
      charterKpis = null;
    }
  }

  return {
    projectId: project.id,
    projectName: project.project_name,
    models: rolledModels,
    simulations,
    charterKpis,
  };
}
