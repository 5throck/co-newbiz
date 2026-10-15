// Server-side loader for the S8 two-lens summary (ADR-0169). Reads only; the
// result feeds the summary strip, the FS gate-brief line and the S8 pages.
// Decision support: it never writes, caps a grade or blocks a gate.
import type { Database } from "bun:sqlite";
import { resolveProjectHurdleIrr } from "../../../db/lib/wacc.ts";
import { findAdoptedCase, latestTargetSelection, listBusinessCases, type BusinessCaseView } from "./business-case.ts";
import { evaluateTargetsForCase, resolveProjectTargets } from "./business-targets.ts";
import { parseGapRegister } from "./capability-gap.ts";
import { targetJudgementRows, targetScope } from "./brownfield-capability-judgement.ts";
import { sourceOpportunityOf } from "./capability-attainability.ts";
import { buildLensStripView, financialLensStatus, type FinancialLensSummary, type S8LensStripView } from "./s8-lens-status.ts";
import { buildInvestUncertainty, type InvestUncertaintyView } from "./investment-uncertainty-s8.ts";
import { PROJECT_SUBJECT, parseTechnicalLens, summarizeTechnicalLens, targetSubject, type TechnicalLensSummary } from "./technical-lens.ts";

export interface S8LensSummary {
  project_id: string;
  subject: string;
  brownfield: boolean;
  technical: TechnicalLensSummary;
  financial: FinancialLensSummary;
  goals: { goal_count: number; met: number; missed: number };
  strip: S8LensStripView;
  /** ADR-0176 slice 4: latest confirmed S5 simulation output (read-only, informational). */
  invest_uncertainty: InvestUncertaintyView;
}

function p50(c: BusinessCaseView | undefined): { npv: number | null; irr: number | null } {
  const s = c?.simulations.find((x) => x.percentile === "p50");
  return s ? { npv: s.npv_krw_m, irr: s.irr } : { npv: null, irr: null };
}

export function buildS8LensSummary(db: Database, projectId: string): S8LensSummary {
  const proj = db.query("SELECT track FROM md_project WHERE id = ?").get(projectId) as { track: string | null } | null;
  const brownfield = proj?.track === "brownfield";
  const oppId = sourceOpportunityOf(db, projectId);
  const row = oppId ? (db.query("SELECT capability_gap_json AS j FROM opportunity WHERE id = ?").get(oppId) as { j: string | null } | null) : null;
  const s3Rows = parseGapRegister(row?.j ?? null).rows;
  const lens = parseTechnicalLens(row?.j ?? null);
  const selected = brownfield ? latestTargetSelection(projectId)?.targetId ?? null : null;
  const subject = selected ? targetSubject(selected) : PROJECT_SUBJECT;
  // ADR-0171 slice 3: T1 reads the S5 judgement (Green Field) or the selected target's S7
  // judgements (Brown Field). The S3 register row's own GF judgement is ignored for Brown Field.
  let rows = s3Rows;
  if (brownfield) {
    const scope = selected ? targetScope(db, selected) : null;
    rows = scope?.ok
      ? targetJudgementRows(db, scope.target)
      : s3Rows.map(({ attainability: _a, resolution: _r, ...r }) => ({ ...r, resolution: null }));
  }
  const technical = summarizeTechnicalLens(rows, lens, { subject, brownfield });

  let financial: FinancialLensSummary;
  const goals = { goal_count: 0, met: 0, missed: 0, hasCase: false };
  try {
    const list = listBusinessCases(projectId);
    const adopted = findAdoptedCase(list);
    const hurdle = resolveProjectHurdleIrr(db, projectId, {})?.value ?? null;
    const sameAxis = (c: BusinessCaseView, scenario: string) =>
      c.scenario === scenario && c.variant === "market_forward" && (c.target_id ?? null) === (adopted?.target_id ?? null);
    const baseCase = adopted ? list.cases.find((c) => sameAxis(c, "base")) : undefined;
    const downside = adopted ? list.cases.find((c) => sameAxis(c, "downside")) : undefined;
    let missed = 0;
    let goalCount = 0;
    let met = 0;
    if (adopted) {
      try {
        const resolved = resolveProjectTargets(projectId).resolved;
        goalCount = resolved.length;
        const entries = evaluateTargetsForCase(resolved, adopted);
        missed = entries.filter((e) => e.status === "missed").length;
        met = entries.filter((e) => e.status === "met").length;
      } catch { /* goals unavailable: no goal signal */ }
    }
    Object.assign(goals, { goal_count: goalCount, met, missed, hasCase: !!adopted });
    financial = financialLensStatus({
      hasAdoptedCase: !!adopted,
      baseIrr: p50(baseCase).irr,
      hurdleIrr: typeof hurdle === "number" ? hurdle : null,
      downsideNpvP50: p50(downside).npv,
      missedGoals: missed,
      goalCount,
    });
  } catch {
    financial = financialLensStatus({ hasAdoptedCase: false, baseIrr: null, hurdleIrr: null, downsideNpvP50: null, missedGoals: 0, goalCount: 0 });
  }

  return {
    project_id: projectId,
    subject,
    brownfield,
    technical,
    financial,
    goals: { goal_count: goals.goal_count, met: goals.met, missed: goals.missed },
    strip: buildLensStripView(technical, financial, { goalCount: goals.goal_count, met: goals.met, hasCase: goals.hasCase }),
    invest_uncertainty: buildInvestUncertainty(db, projectId),
  };
}
