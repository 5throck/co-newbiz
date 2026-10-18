// S5 investment plan -> business_case_model (kind='greenfield_cost') copy, shared by
// project promotion (ADR-0137/0138/0173) and the human-triggered S8 re-import (ADR-0174).
// Rules: only lines with a confirmed unit and KRW currency are copied; unconfirmed-unit and
// non-KRW lines are reported, never copied; capability lump sums are recomputed from the live
// judgements; nothing is fabricated; amounts are 백만원.
import type { Database } from "bun:sqlite";
import { parseGapRegister } from "../../app/web-next/lib/capability-gap.ts";
import { manualLineInKrw, manualLineKrwM, type FxRates, sourceRowOf, splitForPromotion } from "../../app/web-next/lib/capability-cost-lines.ts";
import { readFx } from "./entry-market.repository.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit } from "../lib/access-control.ts";

type S5Line = { line: string; category: string; amount: number; amountUnit?: string; note?: string; period?: string; currency?: string; startYear?: number; endYear?: number; growthRate?: unknown };

const VALID_CATEGORIES = new Set(["labor", "opex", "capex", "revenue", "gov_rnd"]);
const PERIOD_MULTIPLIER: Record<string, number> = { monthly: 12, quarterly: 4, yearly: 1, lumpsum: 1 };

function fxRatesOf(db: Database, opportunityId: string): FxRates {
  return Object.fromEntries(readFx(db, opportunityId).map((f) => [f.currency, f.rate]));
}

/** Copy the S5 line's own growth rate, validated and clamped to [0,1] (ratio, like the other
 *  rate fields). A missing, non-finite or negative rate copies as 0 — never fabricated. */
function lineGrowthRate(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  return Math.min(v, 1);
}

export type S5SkipReason = "unit_unconfirmed" | "currency_non_krw" | "invalid_line";

export interface S5ImportPlan {
  lines: S5Line[];
  split: ReturnType<typeof splitForPromotion>;
  /** Manual lines dropped by the category/name filter (promotion drops them silently). */
  invalid: number;
  importable: number;
}

/** Pure read of what an import of this opportunity's S5 plan would copy. */
export function planS5Import(db: Database, opportunityId: string, fxRates?: FxRates): S5ImportPlan {
  const assessment = db
    .query("SELECT business_case_lines_json FROM greenfield_assessment WHERE opportunity_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(opportunityId) as { business_case_lines_json: string | null } | undefined;
  let lines: S5Line[] = [];
  try {
    lines = assessment?.business_case_lines_json ? JSON.parse(assessment.business_case_lines_json) : [];
  } catch { /* malformed — treat as none, don't block promotion over it */ }
  const gapJson = (db.query("SELECT capability_gap_json AS j FROM opportunity WHERE id = ?").get(opportunityId) as { j: string | null } | undefined)?.j;
  const split = splitForPromotion(Array.isArray(lines) ? lines : [], parseGapRegister(gapJson).rows.map(sourceRowOf), fxRates);
  const manualAll = split.manual as S5Line[];
  const kept = manualAll.filter((l) => l?.line?.trim() && VALID_CATEGORIES.has(l.category));
  return { lines: kept, split, invalid: manualAll.length - kept.length, importable: kept.length + split.capability.length };
}

export interface S5ImportResult {
  modelId: string | null;
  manualCopied: number;
  capabilityCopied: number;
}

/** Writes the model + lines (caller owns the transaction). No model when nothing is importable. */
export function writeS5CostModel(
  db: Database,
  opts: { projectId: string; opportunityId: string; actor: string; now: string; modelName: string; auditSkips: boolean },
): S5ImportResult {
  const fxRates = fxRatesOf(db, opts.opportunityId);
  const plan = planS5Import(db, opts.opportunityId, fxRates);
  const { split, lines } = plan;
  if (lines.length === 0 && split.capability.length === 0) return { modelId: null, manualCopied: 0, capabilityCopied: 0 };
  const { actor, now } = opts;
  const modelId = ulid();
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    [modelId, opts.projectId, "greenfield_cost", opts.modelName, split.horizon, actor, now],
  );
  for (const l of lines) {
    const periodMult = PERIOD_MULTIPLIER[l.period ?? "yearly"] ?? 1;
    // Canonical 백만원 from the confirmed unit (FX-converted for foreign lines); splitForPromotion
    // already excluded unconfirmed/no-rate lines.
    const annualAmount = (manualLineKrwM(manualLineInKrw(l, fxRates)) ?? 0) * periodMult;
    const startYear = l.startYear ?? 1;
    // A lump sum spends in its start year only (ADR-0174 slice 2); a recurring
    // line without an explicit end year runs through the model horizon.
    const endYear = l.period === "lumpsum" ? startYear : l.endYear ?? null;
    const flags: string[] = [];
    if (l.period === "lumpsum") flags.push("일시불 총액 — 연반복 아님");
    const note = [...flags, l.note?.trim() || "S5에서 이관됨 — 검증 필요"].join(". ");
    db.run(
      `INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, unit, start_year, end_year, growth_rate, note, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), modelId, l.category, l.line.trim(), annualAmount, "KRW_M", startYear, endYear, lineGrowthRate(l.growthRate), note, actor, now],
    );
  }
  for (const c of split.capability) {
    db.run(
      `INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, unit, start_year, end_year, growth_rate, note, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), modelId, c.category, c.name, c.krwM, "KRW_M", c.startYear, c.endYear ?? c.startYear, 0, c.note, actor, now],
    );
  }
  if (opts.auditSkips) {
    if (split.skipped.length > 0) {
      appendAudit(db, { actor, action: "capability_cost.promotion_skipped", target: `${opts.opportunityId}:${split.skipped.join(",")}`, now });
    }
    for (const s of split.skippedManual) {
      appendAudit(db, { actor, action: "greenfield_cost.promotion_skipped", target: `${opts.opportunityId}:${s.reason}:${s.line.slice(0, 80)}`, now });
    }
  }
  return { modelId, manualCopied: lines.length, capabilityCopied: split.capability.length };
}

export interface S5ReimportPreview {
  importable: number;
  manual_lines: number;
  capability_lines: number;
  skipped: Array<{ line: string; reason: S5SkipReason | "capability_unreflected_or_unpriced" }>;
  will_archive: Array<{ id: string; name: string; created_at: string }>;
}

function activeCostModels(db: Database, projectId: string) {
  return db
    .query("SELECT id, name, created_at FROM business_case_model WHERE project_id = ? AND kind = 'greenfield_cost' AND target_id IS NULL AND archived_at IS NULL ORDER BY created_at, id")
    .all(projectId) as Array<{ id: string; name: string; created_at: string }>;
}

export class S5ReimportError extends Error {
  constructor(public code: "not_found" | "not_greenfield" | "no_importable_lines", message: string) { super(message); }
}

function greenfieldOpportunity(db: Database, projectId: string): string {
  const p = db.query("SELECT track, source_opportunity_id FROM md_project WHERE id = ?").get(projectId) as { track: string | null; source_opportunity_id: string | null } | undefined;
  if (!p) throw new S5ReimportError("not_found", "project not found");
  if (p.track !== "greenfield" || !p.source_opportunity_id) throw new S5ReimportError("not_greenfield", "S5 투자 계획 재이관은 Green Field 프로젝트에서만 가능합니다.");
  return p.source_opportunity_id;
}

export function previewS5Reimport(db: Database, projectId: string): S5ReimportPreview {
  const plan = planS5Import(db, greenfieldOpportunity(db, projectId));
  if (plan.importable === 0) throw new S5ReimportError("no_importable_lines", "이관할 수 있는 S5 투자비 라인이 없습니다 (단위 확정·KRW 라인 없음).");
  const skipped: S5ReimportPreview["skipped"] = [
    ...plan.split.skippedManual.map((s) => ({ line: s.line, reason: s.reason })),
    ...(plan.invalid > 0 ? [{ line: `${plan.invalid}건`, reason: "invalid_line" as const }] : []),
    ...plan.split.skipped.map((k) => ({ line: k, reason: "capability_unreflected_or_unpriced" as const })),
  ];
  return { importable: plan.importable, manual_lines: plan.lines.length, capability_lines: plan.split.capability.length, skipped, will_archive: activeCostModels(db, projectId) };
}

export function applyS5Reimport(db: Database, projectId: string, actor: string, nowIso: string = new Date().toISOString()) {
  const opportunityId = greenfieldOpportunity(db, projectId);
  return db.transaction(() => {
    const preview = previewS5Reimport(db, projectId);
    const archived = preview.will_archive.map((m) => m.id);
    const res = writeS5CostModel(db, { projectId, opportunityId, actor, now: nowIso, modelName: `S5 투자비 검토 요건 (재이관 ${nowIso.slice(0, 10)})`, auditSkips: false });
    for (const id of archived) db.run("UPDATE business_case_model SET archived_at = ?, archived_by = ? WHERE id = ?", [nowIso, actor, id]);
    const counts = `manual=${res.manualCopied},capability=${res.capabilityCopied},skipped=${preview.skipped.length}`;
    appendAudit(db, { actor, action: "business_case.s5_reimport", target: `${projectId}:new=${res.modelId}:old=${archived.join("|") || "-"}:${counts}`, now: nowIso });
    return { model_id: res.modelId as string, archived_model_ids: archived, imported: preview.importable, manual_lines: res.manualCopied, capability_lines: res.capabilityCopied, skipped: preview.skipped };
  })();
}
