// greenfield-structure-view — pure view helpers for the greenfield S10 establishment
// structure (ADR-0160). Client-safe: no server or db imports. Mirrors the server rules in
// greenfield-structure.ts and capex-tranches.ts so the form can refuse early; the server stays
// the authority.

export type TrancheStatus = "planned" | "released" | "withheld";

export interface TrancheView {
  id: string;
  tranche_no: number;
  amount: number;
  currency: string;
  release_condition: string;
  status: TrancheStatus;
  status_reason: string | null;
  source_stage: string;
  created_by?: string;
  /** Open release request awaiting a second, distinct person. */
  pending_release?: { requested_by: string; requested_at: string } | null;
}

/** Status transitions the server allows (released is terminal). */
const ALLOWED: Record<TrancheStatus, TrancheStatus[]> = { planned: ["released", "withheld"], withheld: ["planned", "released"], released: [] };

export function allowedTrancheTransitions(status: TrancheStatus): TrancheStatus[] {
  return ALLOWED[status] ?? [];
}

export type ReleaseActionKind = "request" | "approve" | "awaiting_other" | "creator_blocked";

export interface ReleaseAction {
  kind: ReleaseActionKind;
  /** Menu / button label for the release step (never colour-only). */
  label: string;
  /** Whether this viewer may submit the release call. */
  allowed: boolean;
  /** Visible state text for the row. */
  stateText: string | null;
}

/**
 * Two-person release: the first set_status 'released' only records a request; a second person who is
 * neither the requester nor the tranche creator approves it. Hide approve for the requester and creator.
 */
export function releaseAction(t: Pick<TrancheView, "created_by" | "pending_release">, meUserId: string | null): ReleaseAction {
  const pending = t.pending_release ?? null;
  if (!pending) {
    return { kind: "request", label: "집행 요청 기록", allowed: true, stateText: null }; // INTERIM-WORDING
  }
  const stateText = `${pending.requested_by}이(가) 집행을 요청했습니다 — 다른 한 사람의 승인이 필요합니다.`; // INTERIM-WORDING
  if (meUserId && pending.requested_by === meUserId) {
    return { kind: "awaiting_other", label: "집행 승인", allowed: false, stateText: `${stateText} 요청한 본인은 승인할 수 없습니다.` }; // INTERIM-WORDING
  }
  if (meUserId && t.created_by && t.created_by === meUserId) {
    return { kind: "creator_blocked", label: "집행 승인", allowed: false, stateText: `${stateText} 트랜치를 작성한 본인은 승인할 수 없습니다.` }; // INTERIM-WORDING
  }
  return { kind: "approve", label: "집행 승인", allowed: true, stateText };
}

/** Korean text for a tranche write error code. */
export function trancheErrorText(code: string | undefined, fallback: string): string {
  if (code === "second_person_required") return "집행은 트랜치 작성자와 집행 요청자가 아닌 다른 사람이 승인해야 합니다."; // INTERIM-WORDING
  return fallback;
}

/** Released tranches are immutable (no edit, no retire). */
export function trancheEditable(status: TrancheStatus): boolean {
  return status !== "released";
}

export function nextTrancheNo(tranches: readonly { tranche_no: number }[]): number {
  return tranches.reduce((m, t) => Math.max(m, t.tranche_no), 0) + 1;
}

export interface FieldVisibility { assetOrStock: boolean; stakeType: boolean; instrumentMix: boolean }

/** M&A-only inputs are hidden on greenfield; the stake is shown only for a JV vehicle ("our share in JV"). */
export function hypothesisFieldVisibility(greenfield: boolean, vehicle: string): FieldVisibility {
  if (!greenfield) return { assetOrStock: true, stakeType: true, instrumentMix: true };
  return { assetOrStock: false, stakeType: vehicle === "jv", instrumentMix: false };
}

export interface HypothesisForm {
  vehicle: string; asset_or_stock: string; stake_type: string; instrument_mix: string;
  tax_structure_note: string; liability_isolation_note: string; financing_leverage_note: string; exit_structure_note: string; rationale: string;
}

/** Builds the POST body. Brownfield: exactly the previous shape. Greenfield: M&A-only inputs are omitted (stored null). */
export function buildHypothesisPayload(greenfield: boolean, f: HypothesisForm): Record<string, unknown> {
  const vis = hypothesisFieldVisibility(greenfield, f.vehicle);
  return {
    action: "hypothesize",
    ...f,
    vehicle: f.vehicle || null,
    asset_or_stock: vis.assetOrStock ? f.asset_or_stock || null : null,
    stake_type: vis.stakeType ? f.stake_type || null : null,
    instrument_mix: vis.instrumentMix ? f.instrument_mix || null : null,
  };
}

export interface TrancheForm { trancheNo: string; amount: string; currency: string; releaseCondition: string }

export function validateTrancheForm(f: TrancheForm, existingNos: readonly number[] = []): string | null {
  const no = Number(f.trancheNo);
  if (!Number.isInteger(no) || no < 1) return "트랜치 번호는 1 이상의 정수여야 합니다.";
  if (existingNos.includes(no)) return `트랜치 ${no}번이 이미 있습니다.`;
  const amt = f.amount.trim() === "" ? NaN : Number(f.amount);
  if (!Number.isFinite(amt) || amt <= 0) return "금액은 0보다 큰 숫자여야 합니다.";
  if (f.currency.trim() && !/^[A-Z]{3}$/.test(f.currency.trim())) return "통화는 KRW처럼 대문자 세 글자 코드여야 합니다.";
  if (!f.releaseCondition.trim()) return "집행 조건을 입력하세요.";
  return null;
}

export interface TrancheSummary { currency: string; total: number; planned: number; released: number; withheld: number }

/** Per-currency totals; currencies are never mixed. */
export function trancheSummary(tranches: readonly TrancheView[]): TrancheSummary[] {
  const by = new Map<string, TrancheSummary>();
  for (const t of tranches) {
    const s = by.get(t.currency) ?? { currency: t.currency, total: 0, planned: 0, released: 0, withheld: 0 };
    s.total += t.amount;
    s[t.status] += t.amount;
    by.set(t.currency, s);
  }
  return [...by.values()];
}

export interface BalanceView { balanced: boolean; diff: number; text: string }

/** Sources = uses check wording (completion predicate: balanced and uses > 0). */
export function balanceView(totals: { sources: number; uses: number; balanced: boolean } | undefined): BalanceView | null {
  if (!totals) return null;
  const diff = Math.round((totals.sources - totals.uses) * 10) / 10;
  if (totals.sources === 0 && totals.uses === 0) return { balanced: false, diff, text: "조달·사용 항목이 아직 없습니다 — 사용 금액이 0보다 크고 조달과 같아야 S10이 완료됩니다." };
  if (totals.balanced) return { balanced: true, diff, text: "조달 = 사용 — 균형" };
  return { balanced: false, diff, text: diff > 0 ? `조달이 사용보다 ${Math.abs(diff).toLocaleString("ko-KR")} 백만 KRW 많습니다 — S10 완료 요건 미충족` : `조달이 사용보다 ${Math.abs(diff).toLocaleString("ko-KR")} 백만 KRW 부족합니다 — S10 완료 요건 미충족` };
}

/** True when the loaded greenfield_scope payload marks a greenfield route. */
export function isGreenfieldRoute(scope: unknown): boolean {
  return !!scope && typeof scope === "object";
}
