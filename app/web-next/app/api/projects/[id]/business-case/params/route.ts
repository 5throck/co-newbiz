// Business-case parameter session (design 2026-09-18-s8-business-case-
// evaluation REQ-W6-1..3) — GET resolves the live bc.* parameter set with
// provenance; POST records a user batch on a fresh run (analyst+, rationale
// mandatory). Resolution order: user assumption > derived > default, and
// generation reads exactly this chain — saving then regenerating changes the
// persisted snapshot deterministically.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import {
  INVESTMENT_BASIS_CODES,
  investmentBasisOfCode,
  recordBusinessCaseParams,
  resolveBusinessCaseParams,
  resolveS5InvestmentPlan,
  type InvestmentBasis,
} from "../../../../../../lib/business-case-generator.ts";
import { s5SimStatusForProject } from "../../../../../../lib/investment-simulation-s8.ts";
import { getCurrentS5PlanPin, s5PinStatusForProject } from "../../../../../../lib/s5-plan-pin-s8.ts";
import { s5ConnectViewForProject } from "../../../../../../lib/s5-connect-status.ts";
import { resolveAnchorScopeFlag } from "../../../../../../lib/anchor-scope.ts";
import { pinnedPlanCapexTotal } from "../../../../../../lib/s5-plan-capex.ts";
import { currentPrincipal } from "../../../../../../lib/mcp/principal-context.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const resolved = resolveBusinessCaseParams(getDb(), id);
  // ADR-0176 slice 3: S5 investment-simulation consumption / staleness of the latest s5_plan case.
  // Informational only - never blocks generation, a gate or a grade.
  let s5Sim = null;
  try { s5Sim = s5SimStatusForProject(getDb(), id); } catch { /* migration pending: omit */ }
  const track = (getDb().query("SELECT track FROM md_project WHERE id = ?").get(id) as { track: string | null } | undefined)?.track ?? null;
  // ADR-0178 slice 0: S5 pin state (copy path vs pinned reference, stale rules). Green Field only;
  // informational - never blocks generation, a gate or a grade.
  let s5Pin = null;
  if (track === "greenfield") {
    try { s5Pin = s5PinStatusForProject(getDb(), id); } catch { /* migration pending: omit */ }
  }
  // S8 `S5 연결` block: S5 simulation run state + the run S8 draws from (Green Field only, informational).
  let s5Connect = null;
  if (track === "greenfield") {
    try { s5Connect = s5ConnectViewForProject(getDb(), id); } catch { /* migration pending: omit */ }
  }
  // ADR-0179 slice 2: anchor scope-compatibility flag — the read model's live
  // truth next to the anchor (generator notes hold what a run used; the two
  // can legitimately disagree right after a scope fix, design §5.2). Additive
  // display field; never blocks generation, a gate or a grade.
  let anchorScope = null;
  try { anchorScope = resolveAnchorScopeFlag(getDb(), id); } catch { /* omit on read failure */ }
  return ok({ params: resolved, s5_sim: s5Sim, s5_pin: s5Pin, s5_connect: s5Connect, track, s5_pin_capex_total_krw_m: track === "greenfield" ? pinnedPlanCapexTotal(getDb(), id) : null, anchor_scope: anchorScope }, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "파라미터 확정은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    params?: Record<string, unknown>;
    rationale?: string;
  } | null;
  const rationale = typeof body?.rationale === "string" ? body.rationale.trim() : "";
  if (!rationale) return badRequest("invalid_request", "파라미터 확정에는 근거(rationale)가 필수입니다.");
  const raw = body?.params ?? {};
  if (Object.keys(raw).some((k) => k.replace(/^bc\./, "").startsWith("acquisition_ev_revenue_band"))) {
    return badRequest("invalid_request", "EV/Revenue 밴드는 사람 전용 경로(business-case/ev-band)로만 확정할 수 있습니다 (use the human-only ev-band route).");
  }
  // ADR-0178: switching a project to the pinned S5 reference is a person's opt-in - never an agent's.
  if (raw["s5_source"] !== undefined && raw["s5_source"] !== null && raw["s5_source"] !== "" && currentPrincipal()) {
    return forbidden("human_only", "S5 고정 참조 사용 전환은 사람만 확정할 수 있습니다 (boundary #2).");
  }
  // ADR-0178 slice 2 (s5_pnl): switching to the plan P&L basis is a person's act too, and it is
  // Green Field + pinned-path only (OD-5/OD-6). Checked before the other field validations.
  if (raw["investment_basis"] !== undefined && raw["investment_basis"] !== null && raw["investment_basis"] !== "") {
    const nb = typeof raw["investment_basis"] === "number" ? investmentBasisOfCode(raw["investment_basis"] as number) : String(raw["investment_basis"]);
    if (nb === "s5_pnl") {
      if (currentPrincipal()) return forbidden("human_only", "S5 계획 손익(s5_pnl) 기준 전환은 사람만 확정할 수 있습니다 (boundary #2).");
      const proj = getDb().query("SELECT track FROM md_project WHERE id = ?").get(id) as { track: string | null } | undefined;
      if (proj?.track !== "greenfield") return badRequest("invalid_request", "s5_pnl 기준은 Green Field 프로젝트에서만 사용할 수 있습니다 (OD-5).");
      if (!getCurrentS5PlanPin(getDb(), id) || !resolveS5InvestmentPlan(getDb(), id)) {
        return badRequest("invalid_request", "s5_pnl 기준은 S5 고정 참조(pinned path)가 있을 때만 사용할 수 있습니다 (OD-6).");
      }
    }
  }
  const num = (key: string): number | undefined => {
    const v = raw[key];
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${key}는 0 이상의 숫자여야 합니다.`);
    return n;
  };
  let parsed: Parameters<typeof recordBusinessCaseParams>[1]["params"];
  try {
    parsed = {
      capture_rate: num("capture_rate"),
      opex_ratio: num("opex_ratio"),
      capex_ratio: num("capex_ratio"),
      initial_investment_ratio: num("initial_investment_ratio"),
      acquisition_ev_revenue: num("acquisition_ev_revenue"),
      fade_horizon_years: num("fade_horizon_years"),
      growth_terminal: num("growth_terminal"),
      growth_override: num("growth_override"),
      sigma_override: num("sigma_override"),
      // ADR-0174: 투자비 기준 — numeric code 0/1/2 (team-lead spec) or the
      // string name; stored as a numeric code in the bc.* assumption value
      // column (REAL NOT NULL).
      investment_basis: (() => {
        const v = raw["investment_basis"];
        if (v === undefined || v === null || v === "") return undefined;
        if (typeof v === "number") {
          if (!Number.isInteger(v) || v < 0 || v > 3) throw new Error("investment_basis는 0, 1, 2, 3 중 하나의 정수여야 합니다.");
          return investmentBasisOfCode(v);
        }
        if (typeof v === "string" && v in INVESTMENT_BASIS_CODES) return v as InvestmentBasis;
        throw new Error("investment_basis는 0|1|2|3 또는 ratio|s5_plan|s5_plan_full|s5_pnl 이어야 합니다.");
      })(),
      // ADR-0178: 0 = promotion copy (default), 1 = pinned S5 reference. Green Field with a pin only.
      s5_source: (() => {
        const v = raw["s5_source"];
        if (v === undefined || v === null || v === "") return undefined;
        const n = Number(v);
        if (n !== 0 && n !== 1) throw new Error("s5_source는 0(복사본) 또는 1(고정 참조)이어야 합니다.");
        if (n === 1) {
          const proj = getDb().query("SELECT track FROM md_project WHERE id = ?").get(id) as { track: string | null } | undefined;
          if (proj?.track !== "greenfield") throw new Error("S5 고정 참조는 Green Field 프로젝트에서만 사용할 수 있습니다.");
          if (!getCurrentS5PlanPin(getDb(), id)) throw new Error("고정된 S5 참조가 없습니다 — 먼저 S5 고정 참조를 만드세요.");
        }
        return n as 0 | 1;
      })(),
      horizon_years: num("horizon_years"),
      iterations: num("iterations"),
      // ADR-0179 slice 1 — IRR ceiling guard thresholds (ratios). Person-settable
      // display metadata; flag > caution is validated again in recordBusinessCaseParams.
      irr_flag_threshold: num("irr_flag_threshold"),
      irr_caution_threshold: num("irr_caution_threshold"),
      ramp_up: Array.isArray(raw.ramp_up)
        ? (raw.ramp_up as unknown[]).map((v) => {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0) throw new Error("ramp_up 항목은 0 이상의 숫자여야 합니다.");
            return n;
          })
        : undefined,
    };
    const result = await recordBusinessCaseParams(getDb(), {
      projectId: id,
      params: parsed,
      rationale,
      actor: auth.auth.userId,
    });
    return ok({ written: result.written, run_id: result.run_id, params: resolveBusinessCaseParams(getDb(), id) }, 201, {
      written_count: String(result.written.length),
    });
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : "파라미터 저장에 실패했습니다.");
  }
}
