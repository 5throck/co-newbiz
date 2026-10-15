// S5 자체 진출 — 기회별 평가 상태 조회/저장.
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../lib/envelope.ts";
import { readRegister } from "../../../../lib/capability-attainability.ts";
import { normalizeStoredEntryStrategy } from "../../../../lib/greenfield-entry-strategy.ts";
import { deriveCapabilityCostLines, milestoneCandidateView, normalizeBusinessCaseLines, planMetaOf, sourceRowOf, DEFAULT_HORIZON_YEARS } from "../../../../lib/capability-cost-lines.ts";
import { maskStaffingPlanInLines, staffingPlanOf, staffingPlanView } from "../../../../lib/staffing-plan.ts";

/** One stored investment line (S5 "투자비 검토 요건"). Capability entries add the ADR-0173 markers. */
interface PostedLine {
  line: string;
  category?: "labor" | "opex" | "capex" | "revenue" | "gov_rnd";
  /** Raw amount in the line's own unit (`amountUnit`). The server recomputes `amountKrwM` when the unit is confirmed. */
  amount: number;
  /** "krw" | "krw_k" | "krw_m" | "krw_eok" | "fx_m" | "fx_eok"; unknown values are rejected with invalid_amount_unit. */
  amountUnit?: string;
  /** Trust flag: true only after a person picked the unit in the UI. Legacy/old-shape lines are normalized to unconfirmed. */
  amountUnitConfirmed?: boolean;
  /** Canonical 백만원 value; recomputed server-side from amount + amountUnit, never taken from the client. */
  amountKrwM?: number | null;
  currency?: "KRW" | "USD" | "EUR" | "JPY" | "CNY";
  period?: "monthly" | "quarterly" | "yearly" | "lumpsum";
  note?: string;
  dupDismissed?: string[];
  source?: "capability";
  capabilityKey?: string;
  reflected?: boolean;
}

const now = () => new Date().toISOString();

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, name, promoted_at, project_id FROM opportunity WHERE id = ?").get(oppId) as { id: string; name: string; promoted_at: string | null; project_id: string | null } | null;
  if (!opp) return notFound();
  const assessment = db
    .query("SELECT * FROM greenfield_assessment WHERE opportunity_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(oppId) as Record<string, unknown> | undefined;
  const parse = (v: unknown) => { try { return v ? JSON.parse(v as string) : null; } catch { return null; } };
  const lines = assessment ? parse(assessment.business_case_lines_json) : null;
  // ADR-0173 slice 1: derived on read from the live judgements; unreflected lines are never stored.
  const reg = readRegister(db, oppId);
  const costView = deriveCapabilityCostLines((reg?.rows ?? []).map(sourceRowOf), lines);
  // ADR-0175 slice 1: the derived labor view is computed from the UNMASKED plan; a read-only
  // (viewer) caller gets the plan with salary/on-cost values removed (the strip still shows).
  const plan = staffingPlanOf(lines);
  const horizon = planMetaOf(lines)?.horizonYears ?? DEFAULT_HORIZON_YEARS;
  const masked = auth.auth.role === "viewer";
  return ok({
    opportunity: opp,
    assessment: assessment
      ? { ...assessment, ...(masked && lines ? { business_case_lines_json: JSON.stringify(maskStaffingPlanInLines(lines)) } : {}), capability_gaps: parse(assessment.capability_gaps_json), business_case_lines: masked ? maskStaffingPlanInLines(lines) : lines }
      : null,
    staffing_plan_view: plan ? staffingPlanView(plan, horizon) : null,
    staffing_plan_masked: masked,
    capability_cost_lines: costView,
    milestone_candidates: (reg?.rows ?? []).flatMap((r) => { const m = milestoneCandidateView(r); return m ? [m] : []; }),
  }, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "역량 평가 저장은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { oppId } = await params;
  // ADR-0136: capability_gaps는 더 이상 이 라우트에서 받지 않는다 — 필요 역량은
  // 오직 S3 레지스터(/api/opportunities/[id]/capability-gap)에만 기록된다.
  const body = (await request.json().catch(() => null)) as {
    entry_strategy?: string;
    alternatives_considered?: string;
    business_case_lines?: PostedLine[];
    rationale?: string;
  } | null;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  // ADR-0171 amendment (2): modes header + rationale share this column; canonical form on write (legacy text only trimmed).
  const entryStrategy = typeof body?.entry_strategy === "string" ? normalizeStoredEntryStrategy(body.entry_strategy) || null : null;
  const ts = now();
  const existing = db.query("SELECT id, business_case_lines_json FROM greenfield_assessment WHERE opportunity_id = ? LIMIT 1").get(oppId) as { id: string; business_case_lines_json: string | null } | undefined;
  // ADR-0173: capability entries are rebuilt from the live judgement; a client amount that differs is rejected.
  let storedLines: unknown[] | null = null;
  let lineEvents: Array<{ action: string; target: string }> = [];
  if (body?.business_case_lines !== undefined && body.business_case_lines !== null) {
    let previous: unknown = null;
    try { previous = existing?.business_case_lines_json ? JSON.parse(existing.business_case_lines_json) : null; } catch { previous = null; }
    const norm = normalizeBusinessCaseLines(body.business_case_lines, (readRegister(db, oppId)?.rows ?? []).map(sourceRowOf), previous, { userId: ctx.userId, at: ts });
    if (!norm.ok) return badRequest(norm.error.code, norm.error.message);
    storedLines = norm.lines;
    lineEvents = norm.events;
  }
  const id = existing?.id ?? ulid();
  if (existing) {
    db.run(
      `UPDATE greenfield_assessment SET
         entry_strategy = COALESCE(?, entry_strategy),
         alternatives_considered = COALESCE(?, alternatives_considered),
         business_case_lines_json = COALESCE(?, business_case_lines_json),
         rationale = COALESCE(?, rationale),
         updated_at = ? WHERE id = ?`,
      [
        entryStrategy,
        body?.alternatives_considered?.trim() || null,
        storedLines ? JSON.stringify(storedLines) : null,
        body?.rationale?.trim() || null,
        ts, id,
      ],
    );
  } else {
    db.run(
      `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, business_case_lines_json, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id, oppId,
        entryStrategy,
        body?.alternatives_considered?.trim() || null,
        storedLines ? JSON.stringify(storedLines) : null,
        body?.rationale?.trim() || null,
        ctx.userId, ts, ts,
      ],
    );
  }
  appendAudit(db, { actor: ctx.userId, action: "greenfield_assessment.save", target: `${oppId}:${existing ? "update" : "create"}`, now: ts });
  for (const ev of lineEvents) appendAudit(db, { actor: ctx.userId, action: ev.action, target: `${oppId}#${ev.target}`, now: ts });
  return ok({ id, updated_at: ts }, 200);
}
