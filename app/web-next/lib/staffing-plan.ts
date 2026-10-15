// ADR-0175 slice 1 (ADR status: Proposed — decider acceptance pending; PM directed slice 1 per the
// B′ plan): S5 인력 운영 계획 (staffing plan) — rows by 직무군 × 직급 with per-year headcount,
// aggregate 평균 연봉, editable assumptions, and the derived annual labor cost. Pure and
// client-safe (no db, no node:crypto beyond the shared sha256Hex) so the S5 screen and the route
// share one derivation. Storage is ONE { source: "staffing_plan" } meta entry in the existing
// business_case_lines_json array (design-of-record OD-3; same pattern as ADR-0174's plan_meta) —
// no schema change. Decision support only: creating, editing and confirming the plan are human
// acts; no gate and no grade is affected.
//
// AI seam (design slice 4, NOT implemented here): a future draft route fills EMPTY rows only
// (fill-empty-only), proposes structure and assumption placeholders, and NEVER proposes a salary
// number — no wage reference dataset exists in the repo, so salary fields stay empty unless the
// analyst types a value and cites salarySource. Every proposed value carries a basis string and
// nothing saves without the person's POST.
import { sha256Hex } from "./capability-linkage.ts";

export const STAFFING_PLAN_SOURCE = "staffing_plan" as const;

/** One 직무군 × 직급 row (aggregate only — the schema has no name or individual field). */
export interface StaffingRow {
  /** Stable row id (UI keys, duplicate-guard dismissal, S10 import later). */
  id: string;
  /** 직무군 (free text, e.g. 생산, 품질, 영업). */
  roleFamily: string;
  /** 직급 (free text, e.g. 팀장, 과장, 신입). */
  grade: string;
  /** Index 0 = Y1; trimmed/zero-padded to the horizon on save. */
  headcountByYear: number[];
  /** 평균 연간 기본급 (백만원) — aggregate average, never an individual figure. null = 미입력 (row excluded from cost). */
  avgAnnualBaseSalaryKrwM: number | null;
  /** 연 인상률 % (default 0). */
  salaryIncreaseRatePct: number;
  /** 가산율 % (복리후생·4대보험·퇴직급여) — editable assumption, NO default (OD-2); null = 미입력 (row excluded from cost). */
  onCostRatePct: number | null;
  /** Optional 채용 시작 분기 "YYYY-Qn"; only affects a later S10 import ramp (slice 3). */
  hireStartQuarter: string | null;
  /** 채용·온보딩 일회 비용 (백만원), spent once in the plan startYear. */
  recruitingOneOffKrwM: number;
  /** Provenance of the salary figure: "analyst", a URL, or a dataset name. The AI never fills a salary without one. */
  salarySource: string | null;
}

/** The one meta entry in business_case_lines_json carrying the whole plan. */
export interface StaffingPlanEntry {
  source: typeof STAFFING_PLAN_SOURCE;
  rows: StaffingRow[];
  /** Active window inside the ADR-0174 horizon, 1-based; default 1..N. */
  startYear: number;
  endYear: number;
  /** Attrition backfill % (OD-6): accepted, default 0, costed as a headcount uplift when non-zero; full modelling comes later. */
  attritionBackfillPct: number;
  updatedAt?: string;
  updatedBy?: string;
}

export const isStaffingPlanEntry = (x: unknown): x is Partial<StaffingPlanEntry> & { rows?: unknown } =>
  !!x && typeof x === "object" && !Array.isArray(x) && (x as { source?: unknown }).source === STAFFING_PLAN_SOURCE;

/** First valid staffing_plan meta entry in a stored lines array; null when absent/invalid. */
export function staffingPlanOf(lines: unknown): StaffingPlanEntry | null {
  if (!Array.isArray(lines)) return null;
  for (const l of lines) {
    if (!isStaffingPlanEntry(l)) continue;
    // Stored plans were validated on save; the read horizon is the widest stored headcount array
    // (bounded) so a later horizon change never drops a stored plan.
    const widest = Array.isArray(l.rows) ? Math.max(1, ...l.rows.map((r) => (Array.isArray((r as { headcountByYear?: unknown })?.headcountByYear) ? (r as { headcountByYear: unknown[] }).headcountByYear.length : 0))) : 1;
    const v = normalizeStaffingPlanEntry(l, Math.max(Math.min(widest, 50), typeof l.endYear === "number" ? Math.min(l.endYear, 50) : 1));
    if (v.ok) return v.entry;
  }
  return null;
}

// ── Bounds (design §3; the UI helper text marks every rate an assumption) ────

export const MAX_STAFFING_ROWS = 100; // ENTRY_LIMITS.list (S10 lists cap; design §6)
export const MAX_HEADCOUNT_PER_YEAR = 100_000;
export const MAX_SALARY_KRW_M = 10_000;
export const MAX_RATE_PCT = 100;
const QUARTER_RE = /^\d{4}-Q[1-4]$/;

/** PII scrub on free-text fields: drop control characters (incl. newlines), trim, cap. */
export function scrubStaffingText(v: unknown, cap: number): string {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, cap);
}

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const intOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** headcountByYear trimmed or zero-padded to the horizon (design §3 invariant). */
export function fitHeadcountToHorizon(hc: unknown, horizon: number): number[] {
  const raw = Array.isArray(hc) ? hc : [];
  const out: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const n = intOrNull(raw[i]);
    out.push(n !== null && n >= 0 && n <= MAX_HEADCOUNT_PER_YEAR ? n : 0);
  }
  return out;
}

export type StaffingPlanError = { ok: false; message: string };

/**
 * Validate and normalize a posted/stored staffing_plan entry against the horizon. Invalid values
 * inside a row fail the WHOLE save with a precise message (the route 400s; the client shows it) —
 * there is no silent coercion of a value the person typed.
 */
export function normalizeStaffingPlanEntry(raw: unknown, horizon: number): { ok: true; entry: StaffingPlanEntry } | StaffingPlanError {
  if (!isStaffingPlanEntry(raw) || !Array.isArray(raw.rows)) return { ok: false, message: "인력 운영 계획 항목의 형식이 올바르지 않습니다." };
  if (raw.rows.length > MAX_STAFFING_ROWS) return { ok: false, message: `인력 운영 계획은 최대 ${MAX_STAFFING_ROWS}행까지 저장할 수 있습니다.` };
  const startYear = raw.startYear === undefined ? 1 : intOrNull(raw.startYear);
  const endYear = raw.endYear === undefined ? horizon : intOrNull(raw.endYear);
  if (startYear === null || startYear < 1 || startYear > horizon) return { ok: false, message: `인력 운영 계획의 시작 연차는 1..${horizon}년이어야 합니다.` };
  if (endYear === null || endYear < 1 || endYear > horizon) return { ok: false, message: `인력 운영 계획의 종료 연차는 1..${horizon}년이어야 합니다.` };
  if (endYear < startYear) return { ok: false, message: "인력 운영 계획의 종료 연차는 시작 연차보다 작을 수 없습니다." };
  const attrition = raw.attritionBackfillPct === undefined || raw.attritionBackfillPct === null ? 0 : intOrNull(raw.attritionBackfillPct);
  if (attrition === null || attrition < 0 || attrition > MAX_RATE_PCT) return { ok: false, message: `인력 이탈 보충률은 0..${MAX_RATE_PCT}% 사이여야 합니다.` };
  const rows: StaffingRow[] = [];
  try {
    raw.rows.forEach((r, i) => {
    const n = i + 1;
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new RowError(`${n}번째 행의 형식이 올바르지 않습니다.`);
    const row = r as unknown as Record<string, unknown>;
    const roleFamily = scrubStaffingText(row.roleFamily, 60);
    const grade = scrubStaffingText(row.grade, 60);
    if (!roleFamily) throw new RowError(`${n}번째 행: 직무군을 입력하세요.`);
    if (!grade) throw new RowError(`${n}번째 행: 직급을 입력하세요.`);
    if (Array.isArray(row.headcountByYear) && row.headcountByYear.length > horizon) throw new RowError(`${n}번째 행: 인원 연도 열 수가 검토 기간(${horizon}년)을 넘습니다.`);
    for (const [idx, v] of (Array.isArray(row.headcountByYear) ? row.headcountByYear : []).entries()) {
      const hc = intOrNull(v);
      if (hc === null || hc < 0 || hc > MAX_HEADCOUNT_PER_YEAR) throw new RowError(`${n}번째 행: ${idx + 1}연차 인원은 0..${MAX_HEADCOUNT_PER_YEAR}명의 정수여야 합니다.`);
    }
    let salary: number | null = null;
    if (row.avgAnnualBaseSalaryKrwM !== undefined && row.avgAnnualBaseSalaryKrwM !== null && row.avgAnnualBaseSalaryKrwM !== "") {
      const s = intOrNull(row.avgAnnualBaseSalaryKrwM);
      if (s === null || s < 0 || s > MAX_SALARY_KRW_M) throw new RowError(`${n}번째 행: 평균 연봉은 0..${MAX_SALARY_KRW_M}백만원 사이여야 합니다.`);
      salary = s;
    }
    let increase = 0;
    if (row.salaryIncreaseRatePct !== undefined && row.salaryIncreaseRatePct !== null && row.salaryIncreaseRatePct !== "") {
      const p = intOrNull(row.salaryIncreaseRatePct);
      if (p === null || p < 0 || p > MAX_RATE_PCT) throw new RowError(`${n}번째 행: 연 인상률은 0..${MAX_RATE_PCT}% 사이여야 합니다.`);
      increase = p;
    }
    let onCost: number | null = null;
    if (row.onCostRatePct !== undefined && row.onCostRatePct !== null && row.onCostRatePct !== "") {
      const p = intOrNull(row.onCostRatePct);
      if (p === null || p < 0 || p > MAX_RATE_PCT) throw new RowError(`${n}번째 행: 가산율은 0..${MAX_RATE_PCT}% 사이여야 합니다 (HR·법무 확인 필요).`);
      onCost = p;
    }
    const quarter = row.hireStartQuarter === undefined || row.hireStartQuarter === null || row.hireStartQuarter === "" ? null : String(row.hireStartQuarter);
    if (quarter !== null && !QUARTER_RE.test(quarter)) throw new RowError(`${n}번째 행: 채용 시작 분기는 YYYY-Qn 형식이어야 합니다 (예: 2027-Q1).`);
    let recruiting = 0;
    if (row.recruitingOneOffKrwM !== undefined && row.recruitingOneOffKrwM !== null && row.recruitingOneOffKrwM !== "") {
      const c = intOrNull(row.recruitingOneOffKrwM);
      if (c === null || c < 0) throw new RowError(`${n}번째 행: 채용 일회비는 0 이상이어야 합니다.`);
      recruiting = c;
    }
    const source = row.salarySource === undefined || row.salarySource === null || row.salarySource === "" ? null : scrubStaffingText(row.salarySource, 200);
    rows.push({
      id: scrubStaffingText(row.id, 64) || `sr${i + 1}`,
      roleFamily,
      grade,
      headcountByYear: fitHeadcountToHorizon(row.headcountByYear, horizon),
      avgAnnualBaseSalaryKrwM: salary,
      salaryIncreaseRatePct: increase,
      onCostRatePct: onCost,
      hireStartQuarter: quarter,
      recruitingOneOffKrwM: recruiting,
      salarySource: source,
    });
    });
  } catch (e) {
    return { ok: false, message: e instanceof RowError ? e.message : "인력 운영 계획 항목의 형식이 올바르지 않습니다." };
  }
  return {
    ok: true,
    entry: { source: STAFFING_PLAN_SOURCE, rows, startYear, endYear: endYear as number, attritionBackfillPct: attrition as number },
  };
}
class RowError extends Error {}

/** True when two plans differ structurally (rows/windows/rates) — ignores updatedAt/updatedBy stamps. */
export function staffingPlanChanged(a: StaffingPlanEntry | null, b: StaffingPlanEntry): boolean {
  if (!a) return b.rows.length > 0 || b.attritionBackfillPct !== 0 || b.startYear !== 1;
  const strip = (p: StaffingPlanEntry) => JSON.stringify({ rows: p.rows, startYear: p.startYear, endYear: p.endYear, attritionBackfillPct: p.attritionBackfillPct });
  return strip(a) !== strip(b);
}

// ── Audit ───────────────────────────────────────────────────────────────────

/**
 * Audit hash of the plan WITHOUT the salary/on-cost values: the audit target must never carry
 * compensation figures. Structure (직무군·직급·인원·windows) is enough for post-hoc change
 * detection of the shape; value-level change detection on salary stays in the storage row.
 */
export function staffingPlanAuditHash(entry: Pick<StaffingPlanEntry, "rows" | "startYear" | "endYear" | "attritionBackfillPct">): string {
  const body = {
    rows: entry.rows.map((r) => ({ roleFamily: r.roleFamily, grade: r.grade, headcountByYear: r.headcountByYear, hasSalary: r.avgAnnualBaseSalaryKrwM !== null, hasOnCost: r.onCostRatePct !== null, recruitingOneOffKrwM: r.recruitingOneOffKrwM })),
    startYear: entry.startYear,
    endYear: entry.endYear,
    attritionBackfillPct: entry.attritionBackfillPct,
  };
  return sha256Hex(JSON.stringify(body)).slice(0, 16);
}

// ── Derived outputs (computed, never stored) ────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 인건비 미계상 flag labels (design §9 sanity warnings). */
export const FLAG_NO_SALARY = "급여 미입력 — 인건비 미계상";
export const FLAG_NO_ONCOST = "가산율 미입력 — HR·법무 확인 필요";
export const FLAG_HEADCOUNT_DIP = "감원 후 재증가 — 의도 확인";

export interface StaffingRowResult {
  rowId: string;
  label: string;
  /** 백만원 per year (Y1..Y{horizon}); null = the row is not costed that year (no salary/on-cost, or outside the window). */
  costByYear: Array<number | null>;
  recruitingOneOffKrwM: number;
  flags: string[];
}

export interface StaffingPlanView {
  rows: StaffingRowResult[];
  /** 총 인건비 per year (costed rows only + backfill uplift), 백만원. */
  costByYear: number[];
  /** 총 인건비 over the horizon (excludes recruiting one-offs). */
  totalKrwM: number;
  /** 채용 일회비 합계 (백만원), spent in startYear. */
  recruitingTotalKrwM: number;
  headcountByYear: number[];
  /** 연평균 인원 (명); null when the horizon is empty. */
  avgHeadcount: number | null;
  /** Rows with headcount but no salary (인건비 미계상). */
  needSalaryCount: number;
  /** Rows with a salary but no on-cost (costed? no — excluded until the rate is entered). */
  needOnCostCount: number;
  needConfirmCount: number;
}

/**
 * Annual labor cost for row r and 1-based year y:
 * headcountByYear[y-1] × avgAnnualBaseSalaryKrwM × (1 + increase/100)^(y-1) × (1 + onCost/100)
 * (× (1 + attrition/100) when a backfill rate is set, OD-6), active only for
 * startYear ≤ y ≤ endYear. A row with no salary OR no on-cost rate is never costed (null) —
 * never costed at zero silently (design §3 invariant).
 */
export function rowAnnualCostKrwM(row: StaffingRow, plan: Pick<StaffingPlanEntry, "startYear" | "endYear" | "attritionBackfillPct">, horizon: number, y: number): number | null {
  if (y < plan.startYear || y > Math.min(plan.endYear, horizon)) return null;
  if (row.avgAnnualBaseSalaryKrwM === null || row.onCostRatePct === null) return null;
  const hc = row.headcountByYear[y - 1] ?? 0;
  if (hc <= 0) return 0;
  const growth = Math.pow(1 + row.salaryIncreaseRatePct / 100, y - 1);
  const backfill = plan.attritionBackfillPct > 0 ? 1 + plan.attritionBackfillPct / 100 : 1;
  return round2(hc * row.avgAnnualBaseSalaryKrwM * growth * (1 + row.onCostRatePct / 100) * backfill);
}

/** Whole-plan derived view for the result strip and the summary vector. */
export function staffingPlanView(entry: StaffingPlanEntry, horizon: number): StaffingPlanView {
  const H = Math.max(1, Math.floor(horizon));
  const costByYear = Array<number>(H).fill(0);
  const headcountByYear = Array<number>(H).fill(0);
  const rows: StaffingRowResult[] = [];
  let totalKrwM = 0;
  let recruitingTotalKrwM = 0;
  let needSalaryCount = 0;
  let needOnCostCount = 0;
  for (const r of entry.rows) {
    const hcSum = r.headcountByYear.reduce((s, n) => s + n, 0);
    for (let y = 1; y <= H; y++) headcountByYear[y - 1] += r.headcountByYear[y - 1] ?? 0;
    const flags: string[] = [];
    if (hcSum > 0 && r.avgAnnualBaseSalaryKrwM === null) { flags.push(FLAG_NO_SALARY); needSalaryCount += 1; }
    else if (hcSum > 0 && r.onCostRatePct === null) { flags.push(FLAG_NO_ONCOST); needOnCostCount += 1; }
    let rose = false;
    for (const hc of r.headcountByYear) { if (hc > 0) rose = true; else if (rose) { flags.push(FLAG_HEADCOUNT_DIP); break; } }
    const costBy: Array<number | null> = [];
    for (let y = 1; y <= H; y++) {
      const c = rowAnnualCostKrwM(r, entry, H, y);
      costBy.push(c);
      if (c !== null) { costByYear[y - 1] += c; totalKrwM += c; }
    }
    if (r.recruitingOneOffKrwM > 0) recruitingTotalKrwM += r.recruitingOneOffKrwM;
    rows.push({ rowId: r.id, label: `${r.roleFamily} · ${r.grade}`, costByYear: costBy, recruitingOneOffKrwM: r.recruitingOneOffKrwM, flags });
  }
  return {
    rows,
    costByYear: costByYear.map(round2),
    totalKrwM: round2(totalKrwM),
    recruitingTotalKrwM: round2(recruitingTotalKrwM),
    headcountByYear,
    avgHeadcount: H > 0 ? round2(headcountByYear.reduce((s, n) => s + n, 0) / H) : null,
    needSalaryCount,
    needOnCostCount,
    needConfirmCount: needSalaryCount + needOnCostCount,
  };
}

/** Labor vector for the 투자비 요약 (ADR-0174 panel): recurring annual labor per year + recruiting one-offs per year. */
export function staffingSummaryVector(entry: StaffingPlanEntry, horizon: number): { annualByYear: number[]; recruitingByYear: number[] } {
  const view = staffingPlanView(entry, horizon);
  const recruitingByYear = Array<number>(Math.max(1, Math.floor(horizon))).fill(0);
  for (const r of view.rows) if (r.recruitingOneOffKrwM > 0) recruitingByYear[Math.min(entry.startYear, recruitingByYear.length) - 1] += r.recruitingOneOffKrwM;
  return { annualByYear: view.costByYear, recruitingByYear: recruitingByYear.map(round2) };
}

// ── Duplicate guard (ADR-0173 pattern, warning-only + dismissible, OD-7) ────

const normalizeName = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const tokensOf = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0));

/** Token overlap ≥ 60% (smaller set) or containment between the role family and the manual line text/note. */
export function isLikelyStaffingDuplicate(roleFamily: string, manual: { line?: string; note?: string }): boolean {
  const a = normalizeName(roleFamily);
  const b = normalizeName(manual.line ?? "");
  if (a.length >= 2 && b.length >= 2 && (b.includes(a) || a.includes(b))) return true;
  const ta = tokensOf(roleFamily);
  const tb = tokensOf(manual.line ?? "");
  if (ta.size > 0 && tb.size > 0) {
    let common = 0;
    for (const t of ta) if (tb.has(t)) common += 1;
    if (common / Math.min(ta.size, tb.size) >= 0.6) return true;
  }
  const note = normalizeName(manual.note ?? "");
  return a.length >= 2 && note.includes(a);
}

export const STAFFING_DUP_PREFIX = "staffing:";

export interface StaffingDuplicateWarning { rowId: string; rowLabel: string; manualIndex: number; manualLine: string }

/** Manual 인건비 lines overlapping a staffing role family warn (이중 계상 확인); dismissal rides the manual line's dupDismissed as "staffing:<rowId>". */
export function findStaffingDuplicateWarnings(rows: StaffingRow[], manual: Array<{ line?: string; note?: string; dupDismissed?: string[]; source?: unknown; category?: unknown }>): StaffingDuplicateWarning[] {
  const out: StaffingDuplicateWarning[] = [];
  manual.forEach((m, i) => {
    if (!m || m.source === "capability" || !m?.line?.trim() || m.category !== "labor") return;
    for (const r of rows) {
      if (m.dupDismissed?.includes(`${STAFFING_DUP_PREFIX}${r.id}`)) continue;
      if (isLikelyStaffingDuplicate(r.roleFamily, m)) out.push({ rowId: r.id, rowLabel: `${r.roleFamily} · ${r.grade}`, manualIndex: i, manualLine: m.line.trim() });
    }
  });
  return out;
}

/** "1,250백만원" — same format as the capability lib's formatKrwM, kept local to avoid a cycle. */
export const formatStaffingKrwM = (krwM: number): string => `${round2(krwM).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}백만원`;

// ── Read-only role masking (design OD-5) ────────────────────────────────────

/**
 * Copy of the stored lines with salary-sensitive values removed from the staffing_plan entry: the
 * average salary, on-cost rate, increase rate and salary source are nulled and the entry is marked
 * `masked: true` so the client renders "***" with a lock note. Headcount and the derived cost
 * strip are NOT masked (aggregate planning output; a per-field ACL is out of scope, ADR-0175).
 */
export function maskStaffingPlanInLines(lines: unknown): unknown {
  if (!Array.isArray(lines)) return lines;
  return lines.map((l) => {
    if (!isStaffingPlanEntry(l)) return l;
    const rows = Array.isArray(l.rows) ? l.rows.map((r) => (r && typeof r === "object" ? { ...(r as object), avgAnnualBaseSalaryKrwM: null, salaryIncreaseRatePct: 0, onCostRatePct: null, salarySource: null } : r)) : [];
    return { ...l, rows, masked: true };
  });
}

// ── Client helpers ──────────────────────────────────────────────────────────

export const emptyStaffingPlan = (horizon: number): StaffingPlanEntry => ({ source: STAFFING_PLAN_SOURCE, rows: [], startYear: 1, endYear: Math.max(1, horizon), attritionBackfillPct: 0 });

/** Draft plan fitted to the (possibly changed) horizon: headcount trimmed/zero-padded, window clamped. Stamps are dropped. */
export function fitPlanToHorizon(plan: StaffingPlanEntry, horizon: number): StaffingPlanEntry {
  const H = Math.max(1, Math.floor(horizon));
  const startYear = Math.min(Math.max(1, plan.startYear), H);
  const endYear = Math.min(Math.max(startYear, plan.endYear), H);
  return { source: STAFFING_PLAN_SOURCE, startYear, endYear, attritionBackfillPct: plan.attritionBackfillPct, rows: plan.rows.map((r) => ({ ...r, headcountByYear: fitHeadcountToHorizon(r.headcountByYear, H) })) };
}

export const newStaffingRow = (horizon: number): StaffingRow => ({
  id: `sr${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
  roleFamily: "", grade: "", headcountByYear: Array<number>(Math.max(1, horizon)).fill(0),
  avgAnnualBaseSalaryKrwM: null, salaryIncreaseRatePct: 0, onCostRatePct: null, hireStartQuarter: null, recruitingOneOffKrwM: 0, salarySource: null,
});
