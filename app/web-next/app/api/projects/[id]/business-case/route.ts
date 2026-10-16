// Business-case CRUD for one project — the S8 surface (ADR-0098 §3).
// Manual CRUD coexists with automatic generation (POST
// .../business-case/generate); both write paths land in the same
// business_case_model / business_case_line / valuation_simulation tables, so
// the S8 completion check cannot tell the difference and does not need to.
// Visibility is deny-by-default: getProjectIfVisible via visibleProject —
// non-members get 404 (existence itself is protected, FR-SEC-01); admins are
// excluded by role separation. Writes are analyst+.
import { getDb } from "../../../../../../../db/client.ts";
import { resolveEffectiveCagr } from "../../../../../lib/market-calibration.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { listLegacyModels } from "../../../../../lib/business-case-cleanup.ts";
import { listBusinessCases } from "../../../../../lib/business-case.ts";
import { evaluateTargetsForCase, resolveProjectTargets } from "../../../../../lib/business-targets.ts";
import { pinnedPlanCapexTotal } from "../../../../../lib/s5-plan-capex.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";

const KINDS = new Set(["greenfield_cost", "revenue", "valuation", "investment_return"]);
const CATEGORIES = new Set(["labor", "opex", "capex", "revenue", "gov_rnd"]);

interface LineInput {
  category?: string;
  name?: string;
  annual_amount_krw_m?: number;
  sales_volume?: number;
  unit_price_krw?: number;
  start_year?: number;
  growth_rate?: number;
  note?: string;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const { cases, archived, recommendedScenario, adoption, targetSelection, targets, enginesMixed, methodsMixed } = listBusinessCases(id);
  const db = getDb();
  // 에스컬레이션 조정 CAGR (design 2026-09-20-escalation-downstream §4-Q2) —
  // 과거 기반 관점과의 괴리 경고용. 프로젝트 → 원 기회의 산업에서 resolver 조회.
  const opp = db
    .query(
      "SELECT o.market_scope FROM md_project p LEFT JOIN opportunity o ON o.id = p.source_opportunity_id WHERE p.id = ?",
    )
    .get(id) as { market_scope: string | null } | undefined;
  const ind = opp?.market_scope
    ? (db.query("SELECT id FROM md_industry WHERE name_ko = ?").get(opp.market_scope) as { id: string } | undefined)
    : undefined;
  const eff = ind ? resolveEffectiveCagr(db, ind.id) : null;
  // ADR-0159: per-case goal attainment so the scenario comparison can show it for
  // EVERY case (lib functions only; reference evidence, never a gate block).
  // A failed goals lookup must never take the S8 page down (additive field only).
  let goalsResolved: ReturnType<typeof resolveProjectTargets>["resolved"] = [];
  try { goalsResolved = resolveProjectTargets(id).resolved; } catch { /* goals unavailable: attainment omitted */ }
  const goalAttainment: Record<string, ReturnType<typeof evaluateTargetsForCase>> = {};
  // 2026-10-16 (ADR-0178 follow-up): does the plan S8 actually uses (the active pin) carry
  // any capex? Additive display-only flag — drives the IRR no-flow chip in the scenario
  // comparison; never recomputes a case or blocks a gate.
  const trackRow = db.query("SELECT track FROM md_project WHERE id = ?").get(id) as { track: string | null } | undefined;
  const s5PlanCapexZero = trackRow?.track === "greenfield" && pinnedPlanCapexTotal(getDb(), id) === 0;
  return ok(
    { cases, archived, goal_attainment: goalAttainment, goal_count: goalsResolved.length, legacy_models: listLegacyModels(id), recommended_scenario: recommendedScenario, adoption, target_selection: targetSelection, targets, engines_mixed: enginesMixed, methods_mixed: methodsMixed, escalated_cagr_pct: eff?.source === "escalated" ? eff.cagrPct : null, s5_plan_capex_zero: s5PlanCapexZero },
    200,
    { count: cases.length },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Business Case 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    kind?: string;
    horizon_years?: number;
    target_id?: string;
    lines?: LineInput[];
  } | null;
  if (!body?.name?.trim()) return badRequest("invalid_request", "name은 필수입니다.");
  const name = body.name.trim();
  const kind = body.kind ?? "valuation";
  if (!KINDS.has(kind)) return badRequest("invalid_request", `kind는 ${[...KINDS].join(" | ")} 중 하나입니다.`);
  const db = getDb();
  const lineError = validateLines(body.lines ?? []);
  if (lineError) return badRequest("invalid_request", lineError);
  // ADR-0143: a manual case may be attributed to one shortlisted target of
  // the project's source opportunity (validated, never taken on faith).
  let targetId: string | null = null;
  if (body.target_id) {
    const t = db
      .query(
        `SELECT bt.id FROM brownfield_target bt JOIN md_project p ON p.source_opportunity_id = bt.opportunity_id
         WHERE p.id = ? AND bt.id = ? AND bt.status = 'shortlisted'`,
      )
      .get(id, body.target_id) as { id: string } | undefined;
    if (!t) return badRequest("invalid_request", "target_id는 이 프로젝트 Short List의 대상이어야 합니다.");
    targetId = t.id;
  }
  const modelId = ulid();
  const now = new Date().toISOString();
  // All-or-nothing: model + lines land in ONE transaction (mirror of
  // reviewDdCustomItem) so a failure leaves no orphan/partial rows.
  db.transaction(() => {
    db.run(
      "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, target_id) VALUES (?,?,?,?,?,?,?,?)",
      [modelId, id, kind, name, body.horizon_years && body.horizon_years > 0 ? Math.floor(body.horizon_years) : 5, ctx.userId, now, targetId],
    );
    insertLines(db, modelId, body.lines ?? [], ctx.userId, now);
  })();
  return ok({ id: modelId }, 201);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Business Case 수정은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    model_id?: string;
    name?: string;
    horizon_years?: number;
    target_id?: string | null;
    // Full line replacement — the manual editor sends the whole set.
    lines?: LineInput[];
  } | null;
  if (!body?.model_id) return badRequest("invalid_request", "model_id는 필수입니다.");
  const db = getDb();
  const model = db.query("SELECT id FROM business_case_model WHERE id = ? AND project_id = ?").get(body.model_id, id) as
    | { id: string }
    | undefined;
  if (!model) return notFound();
  if (body.target_id !== undefined) {
    if (body.target_id === null) {
      db.run("UPDATE business_case_model SET target_id = NULL WHERE id = ?", [body.model_id]);
    } else {
      const t = db
        .query(
          `SELECT bt.id FROM brownfield_target bt JOIN md_project p ON p.source_opportunity_id = bt.opportunity_id
           WHERE p.id = ? AND bt.id = ? AND bt.status = 'shortlisted'`,
        )
        .get(id, body.target_id) as { id: string } | undefined;
      if (!t) return badRequest("invalid_request", "target_id는 이 프로젝트 Short List의 대상이어야 합니다.");
      db.run("UPDATE business_case_model SET target_id = ? WHERE id = ?", [body.target_id, body.model_id]);
    }
  }
  const now = new Date().toISOString();
  if (typeof body.name === "string" && body.name.trim()) {
    db.run("UPDATE business_case_model SET name = ? WHERE id = ?", [body.name.trim(), body.model_id]);
  }
  if (typeof body.horizon_years === "number" && body.horizon_years > 0) {
    db.run("UPDATE business_case_model SET horizon_years = ? WHERE id = ?", [Math.floor(body.horizon_years), body.model_id]);
  }
  if (Array.isArray(body.lines)) {
    const lineError = validateLines(body.lines);
    if (lineError) return badRequest("invalid_request", lineError);
    const modelId = body.model_id;
    const lines = body.lines;
    // Full-line replacement is all-or-nothing: delete + reinsert inside ONE
    // transaction, so a failed insert never leaves the case without lines.
    db.transaction(() => {
      db.run("DELETE FROM business_case_line WHERE model_id = ?", [modelId]);
      insertLines(db, modelId, lines, ctx.userId, now);
    })();
  }
  return ok({ id: body.model_id }, 200);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Business Case 삭제는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const modelId = new URL(request.url).searchParams.get("model_id");
  if (!modelId) return badRequest("invalid_request", "model_id 쿼리 파라미터가 필요합니다.");
  const db = getDb();
  const model = db.query("SELECT id FROM business_case_model WHERE id = ? AND project_id = ?").get(modelId, id) as
    | { id: string }
    | undefined;
  if (!model) return notFound();
  // valuation_simulation has no ON DELETE CASCADE — remove its rows first.
  db.run("DELETE FROM valuation_simulation WHERE model_id = ?", [modelId]);
  db.run("DELETE FROM business_case_line WHERE model_id = ?", [modelId]);
  db.run("DELETE FROM business_case_model WHERE id = ?", [modelId]);
  appendAudit(db, { actor: auth.auth.userId, action: "business_case.delete", target: `${id}:${modelId}`, now: new Date().toISOString() });
  return ok({ id: modelId }, 200);
}

/** Validate every line BEFORE any insert (the transaction must not fail midway). Returns an error message for the 400 envelope, or null. */
function validateLines(lines: LineInput[]): string | null {
  for (const line of lines) {
    if (!line.category || !CATEGORIES.has(line.category)) {
      return `line category는 ${[...CATEGORIES].join(" | ")} 중 하나입니다.`;
    }
    if (typeof line.annual_amount_krw_m !== "number" || Number.isNaN(line.annual_amount_krw_m)) {
      return "line annual_amount_krw_m은 숫자여야 합니다.";
    }
    // Sales-plan decomposition (design REQ-W1-1) — both nullable, but if one
    // is given the other must be too (revenue = volume x price needs both).
    const hasVolume = line.sales_volume !== undefined && line.sales_volume !== null;
    const hasPrice = line.unit_price_krw !== undefined && line.unit_price_krw !== null;
    if (hasVolume !== hasPrice) {
      return "sales_volume과 unit_price_krw는 함께 입력해야 합니다.";
    }
    for (const [key, value] of [["sales_volume", line.sales_volume], ["unit_price_krw", line.unit_price_krw]] as const) {
      if (value !== undefined && value !== null && (typeof value !== "number" || Number.isNaN(value) || value < 0)) {
        return `line ${key}는 0 이상의 숫자여야 합니다.`;
      }
    }
  }
  return null;
}

/** Insert pre-validated lines. Call inside a transaction. */
function insertLines(db: ReturnType<typeof getDb>, modelId: string, lines: LineInput[], userId: string, now: string): void {
  for (const line of lines) {
    db.run(
      `INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, unit, sales_volume, unit_price_krw, start_year, growth_rate, note, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        ulid(),
        modelId,
        line.category,
        line.name?.trim() || line.category,
        line.annual_amount_krw_m,
        "KRW_M",
        typeof line.sales_volume === "number" ? line.sales_volume : null,
        typeof line.unit_price_krw === "number" ? line.unit_price_krw : null,
        typeof line.start_year === "number" && line.start_year >= 1 ? Math.floor(line.start_year) : 1,
        typeof line.growth_rate === "number" ? line.growth_rate : 0,
        line.note?.trim() || null,
        userId,
        now,
      ],
    );
  }
}
