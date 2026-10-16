// ADR-0178 follow-up (decider feedback 2026-10-16): the wording of the S8 `S5 연결` status and of the
// per-parameter `S5 연동` column. Pure and client-safe (no DB import); display only - these labels
// never link, change or recompute a value. Only rules that are in force today are described:
// the `s5_pnl` basis and the S5-run volatility arrive with ADR-0178 slices 2 and 3.

export type InvestmentBasisKey = "ratio" | "s5_plan" | "s5_plan_full";
/** pinned = 고정 참조로 연결, copy = 복사본(S5 계획 기준), ratio = 비율 추정(S5 금액 미사용). */
export type S5Linkage = "pinned" | "copy" | "ratio";

/** The one unified S5 basis (2026-10-16 decider): stored legacy code 2 (`s5_plan_full`), capex + labor/opex. */
export const S5_UNIFIED_BASIS: InvestmentBasisKey = "s5_plan_full";

export const BASIS_LABEL: Record<InvestmentBasisKey, string> = {
  ratio: "비율 추정",
  s5_plan: "S5 투자 계획 (예전: 설비투자만)",
  s5_plan_full: "S5 투자 계획",
};

/** Hint shown next to a stored legacy capex-only `s5_plan` basis; null when none applies. */
export function s5BasisHint(basis: InvestmentBasisKey): string | null {
  return basis === "s5_plan"
    ? "예전 기준(설비투자만)입니다 — 다음 `S5와 연결하기` 또는 `자동 생성`에서 통합 `S5 투자 계획` 기준(설비투자 + 인건비·운영비)으로 옮겨갑니다."
    : null;
}

export function s5LinkageOf(basis: InvestmentBasisKey, path: "copy" | "pinned" | undefined): S5Linkage {
  if (basis === "ratio") return "ratio";
  return path === "pinned" ? "pinned" : "copy";
}

const pct0 = (v: number): string => `${Math.round(v * 100)}%`;

export interface RatioAssumptions { opexRatio: number; capexRatio: number; initialInvestmentRatio: number }

export interface PinLabelInput { id: string; pinnedAt: string }

/** (a) investment source line of the status block. */
export function s5SourceLine(link: S5Linkage, pin: PinLabelInput | null, ratios: RatioAssumptions): string {
  if (link === "pinned" && pin) return `S5와 연결됨 (고정 참조 ${pin.id.slice(-8)}, ${pin.pinnedAt.slice(0, 10)})`;
  if (link === "ratio") {
    return `S5와 연결 안 됨 — 비율 추정 사용 중 (운영비 ${pct0(ratios.opexRatio)}, 설비투자 ${pct0(ratios.capexRatio)}, year-0 = 매출의 ${pct0(ratios.initialInvestmentRatio)}; S5 금액이 아닌 가정값)`;
  }
  return "복사본 사용 중 (승격 시점 또는 마지막 가져오기 시점의 S5 계획 복사본)";
}

/** (e) what the simulation reaches in S8 today. */
export function s5ScopeNote(basis: InvestmentBasisKey): string {
  const reach =
    basis === "s5_plan_full"
      ? "현재 `S5 투자 계획` 기준에서 S5 시뮬레이션은 설비투자 줄과 인건비·운영비 줄에 도달합니다"
      : basis === "s5_plan"
        ? "예전 기준(설비투자만)에서는 설비투자 줄에만 도달합니다 — 다음 연결 또는 `자동 생성`에서 통합 기준으로 옮겨갑니다"
        : "현재 `비율 추정` 기준에서는 S5 금액도 S5 시뮬레이션도 S8 계산에 쓰이지 않습니다";
  return `${reach}. 인력 계획의 급여·인상률·부대비용·투입 일정 요인은 ADR-0178 슬라이스 3 이후에만 S8에 도달하고, year-0과 S5 줄 기반 연도별 손익 전체(s5_pnl)는 슬라이스 2에서 도입됩니다 — 아직 적용되지 않았습니다.`;
}

export type S5ParamKey = "capture" | "opex" | "capex" | "initial" | "sigma" | "iterations" | "ramp";

export interface S5LinkageContext {
  basis: InvestmentBasisKey;
  /** Confirmed S5 simulation run S8 draws from (null = none). */
  run: { drawCount: number } | null;
  /** S8 bc.iterations. */
  s8Iterations: number;
}

/**
 * `detail` is the one-line reason shown next to a single status chip (chip text = `S5 값` / `가정값`);
 * `text` is the same content as one sentence for places without a chip.
 */
export interface S5LinkageCell { kind: "s5" | "assumed"; detail: string; text: string }

const PNL_REASON = "s5_pnl 기준(슬라이스 2)에서 S5 계획 줄로 대체";

const s5Cell = (detail: string): S5LinkageCell => ({ kind: "s5", detail, text: `S5 값 (${detail})` });
const assumedCell = (reason: string, prefix = "S5 미연동 — "): S5LinkageCell => ({ kind: "assumed", detail: `${prefix}${reason}`, text: `가정값 (${prefix}${reason})` });

/** `S5 연동` cell of one parameter row. */
export function s5ParamLinkage(key: S5ParamKey, ctx: S5LinkageContext): S5LinkageCell {
  const linked = ctx.basis !== "ratio";
  switch (key) {
    case "capture":
      return assumedCell("S5와 무관한 시장 규모 기반 가정");
    case "opex":
      return ctx.basis === "s5_plan_full"
        ? s5Cell("계획이 있는 연도의 인건비·운영비; 없는 연도는 비율")
        : ctx.basis === "s5_plan"
          ? assumedCell("예전 기준(설비투자만) — 다음 연결 또는 `자동 생성` 시 통합 기준에서 S5 계획 금액으로 대체")
          : assumedCell(PNL_REASON);
    case "capex":
      return linked ? s5Cell("계획이 있는 연도의 설비투자; 없는 연도는 비율") : assumedCell(PNL_REASON);
    case "initial":
      return linked ? s5Cell("S5 계획 1차년도 집행액을 year-0로 계상") : assumedCell(PNL_REASON);
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
