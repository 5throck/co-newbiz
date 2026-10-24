// ADR-0178 follow-up (decider feedback 2026-10-16): the wording of the S8 `S5 연결` status and of the
// per-parameter `S5 연동` column. Pure and client-safe (no DB import); display only - these labels
// never link, change or recompute a value. Amendment 2026-10-16: `S5와 연결됨` is the DEFAULT for a
// Green Field project with an importable plan; `복사본` now reads as a person's revert (or the
// window before the first `자동 생성`). Only rules in force today are described: the `s5_pnl`
// basis and the S5-run volatility arrive with ADR-0178 slices 2 and 3. Slice 2 (2026-10-16): the
// `s5_pnl` basis now exists (Green Field + pinned path, person-set) - only the S5-run volatility
// (slice 3) is still pending.

export type InvestmentBasisKey = "ratio" | "s5_plan" | "s5_plan_full" | "s5_pnl";
/** pinned = 고정 참조로 연결, copy = 복사본(S5 계획 기준), ratio = 비율 추정(S5 금액 미사용). */
export type S5Linkage = "pinned" | "copy" | "ratio";

/** The one unified S5 basis (2026-10-16 decider): stored legacy code 2 (`s5_plan_full`), capex + labor/opex. */
export const S5_UNIFIED_BASIS: InvestmentBasisKey = "s5_plan_full";

/** Basis label catalog keys (components.s5Linkage.*) — resolve through t() at render. */
export const BASIS_LABEL: Record<InvestmentBasisKey, string> = {
  ratio: "components.s5Linkage.basisRatio",
  s5_plan: "components.s5Linkage.basisS5Plan",
  s5_plan_full: "components.s5Linkage.basisS5PlanFull",
  s5_pnl: "components.s5Linkage.basisS5Pnl",
};

/** Hint key shown next to a stored legacy capex-only `s5_plan` basis; null when none applies. */
export function s5BasisHintKey(basis: InvestmentBasisKey): string | null {
  return basis === "s5_plan" ? "components.s5Linkage.basisHintLegacy" : null;
}

export function s5LinkageOf(basis: InvestmentBasisKey, path: "copy" | "pinned" | undefined): S5Linkage {
  if (basis === "ratio") return "ratio";
  return path === "pinned" ? "pinned" : "copy";
}

const pct0 = (v: number): string => `${Math.round(v * 100)}%`;

export interface RatioAssumptions { opexRatio: number; capexRatio: number; initialInvestmentRatio: number }

export interface PinLabelInput { id: string; pinnedAt: string }

export interface S5LinePart { key: string; params: Record<string, string> }

/** (a) investment source line of the status block — emit a catalog key + params; resolve through t() at render. */
export function s5SourceLineParts(link: S5Linkage, pin: PinLabelInput | null, ratios: RatioAssumptions): S5LinePart {
  if (link === "pinned" && pin) {
    return { key: "components.s5Linkage.sourcePinned", params: { p1: pin.id.slice(-8), p2: pin.pinnedAt.slice(0, 10) } };
  }
  if (link === "ratio") {
    return {
      key: "components.s5Linkage.sourceRatio",
      params: { p1: pct0(ratios.opexRatio), p2: pct0(ratios.capexRatio), p3: pct0(ratios.initialInvestmentRatio) },
    };
  }
  return { key: "components.s5Linkage.sourceCopy", params: {} };
}

/** (e) what the simulation reaches in S8 today — emit catalog keys; the render joins t() over them in order. */
export function s5ScopeNoteKeys(basis: InvestmentBasisKey): string[] {
  const reach =
    basis === "s5_plan_full"
      ? "components.s5Linkage.scopeReachFull"
      : basis === "s5_plan"
        ? "components.s5Linkage.scopeReachPlan"
        : "components.s5Linkage.scopeReachRatio";
  const pnlTail =
    basis === "s5_pnl" ? "components.s5Linkage.scopePnlTailPnl" : "components.s5Linkage.scopePnlTailOther";
  return [reach, "components.s5Linkage.scopeTail", pnlTail];
}

export type S5ParamKey = "capture" | "opex" | "capex" | "initial" | "sigma" | "iterations" | "ramp";

export interface S5LinkageContext {
  basis: InvestmentBasisKey;
  /** Confirmed S5 simulation run S8 draws from (null = none). */
  run: { drawCount: number } | null;
  /** S8 bc.iterations. */
  s8Iterations: number;
  /** 2026-10-16: the active S5 plan carries no capex line at all (display-only warning). */
  planCapexZero?: boolean;
}

/**
 * `detail` is the one-line reason shown next to a single status chip (chip text = `S5 값` / `가정값`);
 * `text` is the same content as one sentence for places without a chip.
 */
export interface S5LinkageCell { kind: "s5" | "assumed"; detail: string; text: string }

const PNL_REASON = "s5_pnl 기준(슬라이스 2)에서 S5 계획 줄로 대체";
const PNL_OPEX = "계획이 있는 연도의 인건비·운영비·정부R&D; 없는 연도는 가동률 반영 매출 x 비율";
const PNL_CAPEX = "계획이 있는 연도의 설비투자; 계획 기간 외는 가동률 반영 매출 x 비율";
const PNL_INITIAL = "출시 전(start-year 0) 투자 합계를 year-0로 무할인 계상";

const s5Cell = (detail: string): S5LinkageCell => ({ kind: "s5", detail, text: `S5 값 (${detail})` });
const assumedCell = (reason: string, prefix = "S5 미연동 — "): S5LinkageCell => ({ kind: "assumed", detail: `${prefix}${reason}`, text: `가정값 (${prefix}${reason})` });

/** `S5 연동` cell of one parameter row. */
export function s5ParamLinkage(key: S5ParamKey, ctx: S5LinkageContext): S5LinkageCell {
  const linked = ctx.basis !== "ratio";
  switch (key) {
    case "capture":
      return assumedCell("S5와 무관한 시장 규모 기반 가정");
    case "opex":
      return ctx.basis === "s5_pnl"
        ? s5Cell(PNL_OPEX)
        : ctx.basis === "s5_plan_full"
          ? s5Cell("계획이 있는 연도의 인건비·운영비; 없는 연도는 비율")
          : ctx.basis === "s5_plan"
            ? assumedCell("예전 기준(설비투자만) — 다음 연결 또는 `자동 생성` 시 통합 기준에서 S5 계획 금액으로 대체")
            : assumedCell(PNL_REASON);
    case "capex":
      return ctx.basis === "s5_pnl"
        ? s5Cell(ctx.planCapexZero ? `${PNL_CAPEX} — 단, 계획에 설비투자 줄이 없습니다 (S5 값 (0))` : PNL_CAPEX)
        : linked
          ? (ctx.planCapexZero
            ? s5Cell("계획이 있는 연도의 설비투자; 없는 연도는 비율 — 단, 계획에 설비투자 줄이 없습니다")
            : s5Cell("계획이 있는 연도의 설비투자; 없는 연도는 비율"))
          : assumedCell(PNL_REASON);
    case "initial":
      return ctx.basis === "s5_pnl"
        ? s5Cell(ctx.planCapexZero ? `${PNL_INITIAL} — 출시 전 투자 미지정 (0)` : PNL_INITIAL)
        : linked
          ? (ctx.planCapexZero
            ? s5Cell("S5 계획 1차년도 집행액을 year-0로 계상 — 단, 계획에 설비투자 줄이 없어 0입니다")
            : s5Cell("S5 계획 1차년도 집행액을 year-0로 계상"))
          : assumedCell(PNL_REASON);
    case "sigma":
      return assumedCell("슬라이스 3에서 S5 시뮬레이션 반영");
    case "iterations": {
      const n = ctx.run?.drawCount ?? null;
      if (n == null || n <= 0) return assumedCell("확정된 S5 시뮬레이션 실행 없음");
      const m = ctx.s8Iterations;
      const q = m / n;
      const reuse = Number.isInteger(q) ? String(q) : `약 ${(Math.round(q * 10) / 10).toLocaleString("ko-KR")}`;
      return assumedCell(`S5 실행 ${n.toLocaleString("ko-KR")}회 / S8 ${m.toLocaleString("ko-KR")}회 — 한 표본 ${reuse}회 재사용`, "");
    }
    case "ramp":
      return assumedCell("사람이 입력(S5 인력 투입 일정과 다른 개념)");
  }
}
