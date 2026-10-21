// @version 1.0.0
/**
 * risk-heatmap — server-side aggregation of the S9 deal risk heatmap
 * (ADR-0122 #2). Until 2026-10-21 the grid was composed in the browser from
 * three list routes, so nothing server-side could attach a snapshot to the
 * IC package or the quarterly briefing, and covenant headroom (a listed input)
 * was missing. This module builds the same items from the same ledgers —
 * dd_finding, contract_coc, incentive — adds covenant headroom (cov:<key>),
 * applies the person's latest assessment per key (risk_assessment_ledger) and
 * returns a hash-stamped snapshot. Only real records are plotted; nothing is
 * invented when a ledger is empty.
 */
import { createHash } from "node:crypto";
import type { getDb } from "../../../db/client.ts";
import { covenantHeadroom, type CovenantHeadroomRow } from "./covenant-headroom.ts";
import { latestRiskAssessments, type RiskAssessmentRecord } from "./risk-assessment.ts";

type Db = ReturnType<typeof getDb>;
type Level = 1 | 2 | 3;
export type HeatmapSource = "dd" | "coc" | "inc" | "cov";
export type HeatmapSeverity = "high" | "mid" | "low";

export interface HeatmapItem {
  key: string;
  source: HeatmapSource;
  label: string;
  likelihood: Level;
  impact: Level;
  severity: HeatmapSeverity;
  /** The record-derived defaults the person's assessment may have replaced. */
  auto: { likelihood: Level; impact: Level };
  assessed: boolean;
  assessed_by: string | null;
  assessed_at: string | null;
  mitigation: string | null;
}

export interface RiskHeatmap {
  items: HeatmapItem[];
  /** grid[likelihood-1][impact-1] = item count. */
  grid: number[][];
  counts: Record<HeatmapSeverity, number>;
  sources: Record<HeatmapSource, number>;
  /** Latest person assessment time across items, null when none recorded. */
  assessed_at: string | null;
  covenant_status: "computed" | "insufficient_evidence";
  snapshot_hash: string;
}

/** Severity follows the effective likelihood × impact: ≥6 high, ≥3 mid, else low. */
export function severityOf(likelihood: Level, impact: Level): HeatmapSeverity {
  const score = likelihood * impact;
  return score >= 6 ? "high" : score >= 3 ? "mid" : "low";
}

/** Covenant headroom → default likelihood/impact (breached and tight covenants plot high). */
export function covenantDefaults(row: CovenantHeadroomRow): { likelihood: Level; impact: Level } {
  if (row.status === "breached") return { likelihood: 3, impact: 3 };
  if (row.status === "tight") return { likelihood: 3, impact: 2 };
  if (row.status === "ok") return { likelihood: 1, impact: 2 };
  return { likelihood: 2, impact: 2 };
}

function applyAssessment(
  base: Omit<HeatmapItem, "likelihood" | "impact" | "severity" | "assessed" | "assessed_by" | "assessed_at" | "mitigation">,
  assessment: RiskAssessmentRecord | undefined,
): HeatmapItem {
  const likelihood = assessment?.likelihood ?? base.auto.likelihood;
  const impact = assessment?.impact ?? base.auto.impact;
  return {
    ...base,
    likelihood,
    impact,
    severity: severityOf(likelihood, impact),
    assessed: Boolean(assessment),
    assessed_by: assessment?.by ?? null,
    assessed_at: assessment?.at ?? null,
    mitigation: assessment?.mitigation ?? null,
  };
}

export function snapshotHash(items: HeatmapItem[]): string {
  const canonical = [...items]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((i) => [i.key, i.likelihood, i.impact, i.mitigation ?? ""]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

export function buildRiskHeatmap(db: Db, projectId: string): RiskHeatmap {
  const assessments = latestRiskAssessments(db, projectId);
  const items: HeatmapItem[] = [];

  const findings = db
    .query(
      `SELECT id, description, value_impact FROM dd_finding
       WHERE project_id = ? AND target_id IS NULL ORDER BY created_at DESC, id`,
    )
    .all(projectId) as Array<{ id: string; description: string; value_impact: number | null }>;
  for (const f of findings) {
    const negative = f.value_impact != null && f.value_impact < 0;
    const key = `dd:${f.id}`;
    items.push(applyAssessment({ key, source: "dd", label: `DD — ${f.description.slice(0, 24)}`, auto: { likelihood: 2, impact: negative ? 3 : 2 } }, assessments[key]));
  }

  const contracts = db
    .query(
      `SELECT id, counterparty, concentration_pct, est_exit_loss FROM contract_coc
       WHERE project_id = ? ORDER BY concentration_pct DESC, id`,
    )
    .all(projectId) as Array<{ id: string; counterparty: string; concentration_pct: number | null; est_exit_loss: number | null }>;
  for (const c of contracts) {
    const flagged = c.concentration_pct != null && c.concentration_pct >= 30;
    if (!flagged && !c.est_exit_loss) continue;
    const key = `coc:${c.id}`;
    const label = `고객 집중 — ${c.counterparty}${c.concentration_pct != null ? ` (${c.concentration_pct}%)` : ""}`;
    items.push(applyAssessment({ key, source: "coc", label, auto: { likelihood: 2, impact: flagged ? 3 : 2 } }, assessments[key]));
  }

  const incentives = db
    .query("SELECT id, program_name, clawback_rule FROM incentive WHERE project_id = ? ORDER BY rowid")
    .all(projectId) as Array<{ id: string; program_name: string | null; clawback_rule: string | null }>;
  for (const i of incentives) {
    if (!i.clawback_rule) continue;
    const key = `inc:${i.id}`;
    items.push(applyAssessment({ key, source: "inc", label: `클로백 — ${i.program_name ?? "프로그램"}`, auto: { likelihood: 2, impact: 2 } }, assessments[key]));
  }

  const headroom = covenantHeadroom(db, projectId);
  for (const cov of headroom.covenants) {
    const key = `cov:${cov.covenant_key}`;
    const pct = cov.min_headroom_pct != null ? ` (여력 ${Math.round(cov.min_headroom_pct * 1000) / 10}%)` : "";
    const label = `커버넌트 — ${cov.covenant_key}${cov.status === "breached" ? " (위반)" : pct}`;
    items.push(applyAssessment({ key, source: "cov", label, auto: covenantDefaults(cov) }, assessments[key]));
  }

  const grid = [0, 1, 2].map(() => [0, 0, 0]);
  const counts: Record<HeatmapSeverity, number> = { high: 0, mid: 0, low: 0 };
  const sources: Record<HeatmapSource, number> = { dd: 0, coc: 0, inc: 0, cov: 0 };
  let assessedAt: string | null = null;
  for (const it of items) {
    grid[it.likelihood - 1][it.impact - 1] += 1;
    counts[it.severity] += 1;
    sources[it.source] += 1;
    if (it.assessed_at && (!assessedAt || it.assessed_at > assessedAt)) assessedAt = it.assessed_at;
  }
  return { items, grid, counts, sources, assessed_at: assessedAt, covenant_status: headroom.status, snapshot_hash: snapshotHash(items) };
}

/** The compact form attached to the IC package and the monitoring brief. */
export function heatmapSnapshot(heatmap: RiskHeatmap, topN = 10) {
  const order: Record<HeatmapSeverity, number> = { high: 0, mid: 1, low: 2 };
  const top = [...heatmap.items]
    .sort((a, b) => order[a.severity] - order[b.severity] || b.likelihood * b.impact - a.likelihood * a.impact || a.key.localeCompare(b.key))
    .slice(0, topN)
    .map((i) => ({ key: i.key, label: i.label, likelihood: i.likelihood, impact: i.impact, severity: i.severity, assessed: i.assessed, mitigation: i.mitigation }));
  return {
    total: heatmap.items.length,
    counts: heatmap.counts,
    sources: heatmap.sources,
    grid: heatmap.grid,
    top,
    assessed_at: heatmap.assessed_at,
    covenant_status: heatmap.covenant_status,
    snapshot_hash: heatmap.snapshot_hash,
  };
}
