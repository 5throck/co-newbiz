// @version 1.0.0
/**
 * technical-item-constituents — 2026-10-20 decider round 5: each S8 technical lens item
 * (T2~T5) names the S9 DD checklist items that constitute it, so the S8 tab can show
 * WHICH checks stand behind a verdict (with their S9 pass/fail state) instead of a bare
 * chip. Pure mapping over checklist item ids (checklists/*-dd-checklist.yaml); the
 * S8 panel joins them against the live `/dd` response. Client-safe.
 */
/** The S8 technical lens items that are DERIVED from S9 checklist judgements (T1 derives from the
 *  capability judgement, T6 is the pairing progress). 2026-10-20 round 5c (decider): no separate
 *  per-item verdict exists — the S9 DD structure is the judgement home and S8 only rolls it up. */
export const TECHNICAL_ITEM_KEYS = ["T2", "T3", "T4", "T5"] as const;
export type TechnicalItemKey = (typeof TECHNICAL_ITEM_KEYS)[number];

export const TECHNICAL_ITEM_LABELS: Record<TechnicalItemKey, string> = {
  T2: "기술 성숙도(TRL)",
  T3: "핵심 인력·설비·시설",
  T4: "지식재산·라이선스",
  T5: "인허가·인증 확보 가능성",
};

/** Checklist items that make up each lens item — each judged on ITS OWN S9 tab (기술·인사·법무 실사). */
export const TECHNICAL_ITEM_CONSTITUENTS: Record<TechnicalItemKey, readonly string[]> = {
  // 기술 성숙도(TRL): 핵심 공정 TRL 평가 + 병목 공정 식별
  T2: ["tdd-03", "tdd-04"],
  // 핵심 인력·설비·시설: 설비 잔존 수명 · CAPEX 독립 검증 · 핵심 인력 지도 · Day-1 인재 유지
  T3: ["tdd-05", "tdd-07", "hdd-01", "hdd-03"],
  // 지식재산·라이선스: IP 인벤토리 · In/Out 라이선스 · IP 담보·분쟁
  T4: ["ldd-10", "ldd-11", "ldd-12"],
  // 인허가·인증 확보 가능성: 생산 라인 인증 현황 · EHS 부채 · 인허가 이전 분류
  T5: ["tdd-08", "tdd-06", "ldd-15"],
};

/** Evidence prerequisites shared by every technical item (shown under T6 S9 실사 반영 현황). */
export const TECHNICAL_EVIDENCE_BASE: readonly string[] = ["tdd-01", "tdd-02"];

export interface DdItemStatusView { label: string; cls: string; icon: string }

/** S9 checklist state → chip. `null`/unknown = not judged yet. */
export function ddItemStatusView(status: string | null | undefined): DdItemStatusView {
  switch (status) {
    case "pass": return { label: "충족", cls: "status-green", icon: "✓" };
    case "fail": return { label: "미충족", cls: "status-red", icon: "▲" };
    case "na": return { label: "해당 없음", cls: "status-not-started", icon: "·" };
    default: return { label: "판정 대기", cls: "status-amber", icon: "?" };
  }
}

export interface DdItemLookup {
  id: string;
  text: string;
  status: string | null;
  domainTitle: string;
  /** false = the workspace scope excludes this item (ADR-0160 addendum b: N/X takes no
   *  judgement and the S9 tab does not render it) — the lens must treat it as absent,
   *  never as pending (2026-10-22 live-use report: greenfield T3 hung on hdd-03). */
  judgeable: boolean;
}

/** Flatten a `/dd` response (domains → items) into an id-keyed lookup. */
export function indexDdItems(domains: Array<{ title: string; items: Array<{ id: string; text: string; state: { status: string } | null; scope?: { judgeable?: boolean } | null }> }>): Map<string, DdItemLookup> {
  const out = new Map<string, DdItemLookup>();
  for (const d of domains) for (const it of d.items) out.set(it.id, { id: it.id, text: it.text, status: it.state?.status ?? null, domainTitle: d.title, judgeable: it.scope?.judgeable ?? true });
  return out;
}

/** Constituent rows for one lens item — missing ids are kept (the checklist may not carry them for this track). */
export function constituentsOf(key: TechnicalItemKey, index: Map<string, DdItemLookup>): Array<DdItemLookup | { id: string; missing: true }> {
  return TECHNICAL_ITEM_CONSTITUENTS[key].map((id) => index.get(id) ?? { id, missing: true as const });
}

/** Roll-up of the constituent S9 checklist states — the DEFAULT verdict basis (2026-10-20 round 5). */
export type ConstituentRollupStatus = "pass" | "fail" | "pending" | "na";
export interface ConstituentRollup { status: ConstituentRollupStatus; judged: number; total: number; failed: number }

export function rollupConstituentStatuses(statuses: ReadonlyArray<string | null | undefined>): ConstituentRollup {
  const total = statuses.length;
  const failed = statuses.filter((s) => s === "fail").length;
  const judged = statuses.filter((s) => s === "pass" || s === "fail" || s === "na").length;
  const passes = statuses.filter((s) => s === "pass").length;
  if (total === 0) return { status: "pending", judged: 0, total: 0, failed: 0 };
  if (failed > 0) return { status: "fail", judged, total, failed };
  if (judged < total) return { status: "pending", judged, total, failed };
  return { status: passes > 0 ? "pass" : "na", judged, total, failed };
}

export const ROLLUP_LABEL: Record<ConstituentRollupStatus, string> = { pass: "충족", fail: "미충족", pending: "판정 대기", na: "해당 없음" };
