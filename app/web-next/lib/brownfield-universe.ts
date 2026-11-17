// S6 Target Universe shared helpers (DEC-20261111-05, design §4) — the S1
// sizing-version resolution chain (pinned → industry FK → name fallback →
// honest unset) and the draft-route payload builders. Pure module: imports
// nothing heavier than the bun:sqlite Database handle type, so the draft
// route and the unit tests exercise the exact same code. gate-brief's
// private resolveS1MarketRow keeps its committee call sites — consolidation
// onto this resolver is a recorded follow-up (design §11.3), not this batch.
//
// Resolution order (design §4.1, extending gate-brief's ADR-0180-slice-6
// order with the pin first):
//   1. pinned — opportunity.sizing_version_id, only when its analysis is
//      completed (a pin pointing at a non-completed analysis falls through;
//      stated in the manifest, never silently ignored).
//   2. industry_fk — latest completed version for opportunity.industry_id.
//   3. name_fallback — market_scope name join that self-excludes rows whose
//      industry has a set FK, so a drifted same-name industry can never
//      shadow the FK result (the verified $38.66B-vs-$39.88B bug).
//   4. unset — honest labels per gate-brief §9.4; no anchor is quoted.
import type { Database } from "bun:sqlite";
import rules from "./universe-direction-rules.json";
import type { CiteField, EvidenceItem, EvidenceKind, Grade } from "./universe-direction.ts";

/** The market_sizing_version columns the S6 draft reads: version identity,
 * grade columns (ADR-0187 — there is NO grade inside the payload), and the
 * payload itself. Mirrors gate-brief's SizingVersionRow; industry_id comes
 * along so the fact_industry stage-financials read keys on the SAME industry
 * the resolved version belongs to. */
export interface UniverseSizingVersionRow {
  id: string;
  version_no: number;
  payload: string;
  data_confidence_grade: string | null;
  chain_hops: number | null;
  confidence_basis: string | null;
  industry_id: string;
}

export type S1Resolution = "pinned" | "industry_fk" | "name_fallback" | "unset";

export interface UniverseS1Resolution {
  row: UniverseSizingVersionRow | null;
  resolution: S1Resolution;
  /** True when opportunity.sizing_version_id is SET but its analysis is not
   * completed — the pin was discarded and the resolver fell through to step 2
   * or 3 (design §4.1 step 1: the fall-through is "stated in the manifest
   * line, not silently ignored"; QA condition 2, PM dispatch 2026-11-11).
   * False when the pin is absent entirely or resolves. */
  pinDiscarded: boolean;
}

const VERSION_COLUMNS =
  "v.id, v.version_no, v.payload, v.data_confidence_grade, v.chain_hops, v.confidence_basis, a.industry_id AS industry_id";

export function resolveUniverseS1(db: Database, opportunityId: string): UniverseS1Resolution {
  // 1. Pinned — the person-confirmed link (sizing-link route / sizing-auto-link).
  //    A pin pointing at a non-completed analysis falls through to step 2.
  const pinned = db
    .query(
      `SELECT ${VERSION_COLUMNS}
       FROM market_sizing_version v
       JOIN market_sizing_analysis a ON a.id = v.analysis_id
       WHERE v.id = (SELECT sizing_version_id FROM opportunity WHERE id = ?)
         AND a.status = 'completed'
       LIMIT 1`,
    )
    .get(opportunityId) as UniverseSizingVersionRow | undefined;
  if (pinned) return { row: pinned, resolution: "pinned", pinDiscarded: false };
  // Detect the exact stale-pin condition: a pin id is set, it joins to a live
  // version + analysis, but that analysis is not completed. (A NULL pin or a
  // pin with no version row is "absent", not "discarded" — the join returns
  // no row for both, so this stays honest without extra queries.)
  const pinStatus = db
    .query(
      `SELECT a.status AS status
       FROM opportunity o
       JOIN market_sizing_version v ON v.id = o.sizing_version_id
       JOIN market_sizing_analysis a ON a.id = v.analysis_id
       WHERE o.id = ?
       LIMIT 1`,
    )
    .get(opportunityId) as { status: string } | null;
  // bun:sqlite yields null (not undefined) when the join misses — a NULL pin
  // or a pin whose version row is gone is "absent", never "discarded".
  const pinDiscarded = pinStatus !== null && pinStatus.status !== "completed";
  // 2. Industry FK — latest completed version for opportunity.industry_id.
  //    The FK subquery is NULL for an unset industry_id, so this degrades to
  //    no rows instead of a wrong match.
  const fkFirst = db
    .query(
      `SELECT ${VERSION_COLUMNS}
       FROM market_sizing_analysis a
       JOIN market_sizing_version v ON v.analysis_id = a.id
       WHERE a.status = 'completed'
         AND a.industry_id = (SELECT industry_id FROM opportunity WHERE id = ?)
       ORDER BY v.version_no DESC LIMIT 1`,
    )
    .get(opportunityId) as UniverseSizingVersionRow | undefined;
  if (fkFirst) return { row: fkFirst, resolution: "industry_fk", pinDiscarded };
  // 3. Name fallback — market_scope name join with FK self-exclusion: the
  //    `industry_id IS NULL` subquery keeps a drifted same-name industry from
  //    winning while the FK is set.
  const nameFallback = db
    .query(
      `SELECT ${VERSION_COLUMNS}
       FROM market_sizing_analysis a
       JOIN md_industry i ON i.id = a.industry_id
       JOIN market_sizing_version v ON v.analysis_id = a.id
       WHERE a.status = 'completed'
         AND i.name_ko = (SELECT market_scope FROM opportunity WHERE id = ? AND industry_id IS NULL)
       ORDER BY v.version_no DESC LIMIT 1`,
    )
    .get(opportunityId) as UniverseSizingVersionRow | undefined;
  if (nameFallback) return { row: nameFallback, resolution: "name_fallback", pinDiscarded };
  return { row: null, resolution: "unset", pinDiscarded };
}

/** Korean label for a resolution — the `<resolution 라벨>` slot of the S1
 * manifest line (design §4.2). "unset" has no version line; the caller
 * renders the honest-unset label instead. */
export const S1_RESOLUTION_LABEL: Record<Exclude<S1Resolution, "unset">, string> = {
  pinned: "고정 버전",
  industry_fk: "산업 연동",
  name_fallback: "명칭 대체",
};

/** Honest unset label (gate-brief §9.4 style): an opportunity that names no
 * market at all (no market_scope AND no industry FK) gets the parenthesized
 * cause; a named market whose analysis does not resolve keeps the plain
 * label. No anchor is ever quoted for an unset resolution. */
export function s1UnsetLabel(db: Database, opportunityId: string): string {
  const opp = db.query("SELECT market_scope, industry_id FROM opportunity WHERE id = ?").get(opportunityId) as
    | { market_scope: string | null; industry_id: string | null }
    | undefined;
  if (!opp || (opp.market_scope === null && opp.industry_id === null)) return "S1 시장분석: 없음 (market_scope 미지정)";
  return "S1 시장분석: 없음";
}

/** Stale-pin fall-through manifest line (QA condition 2, PM dispatch
 * 2026-11-11; design §4.1 step 1) — emitted when the pin is set but its
 * analysis is not completed and the resolver replaced it with the
 * industry-FK/name-fallback latest, so the reviewer knows the draft ran on
 * other evidence and to re-check after completing the pinned analysis. */
export const STALE_PIN_FALLBACK_LINE =
  "지정 고정 버전이 미완료 상태라 산업 연동 최신 버전으로 대체 — 고정 버전 완료 후 재검토";

interface MatrixLike {
  industryLabel?: string;
  anchor?: { total?: number };
  competitive?: { structure?: string };
}

/** Parse the sizing payload's matrix, tolerating a broken payload (the draft
 * proceeds on the remaining manifest, as before). */
export function parseMatrix(payload: string): MatrixLike {
  try {
    return (JSON.parse(payload) as { matrix?: MatrixLike }).matrix ?? {};
  } catch {
    return {};
  }
}

/**
 * The S1 identity manifest line (design §4.1 note + §4.2 row 1):
 * `S1 시장분석 (고정 버전 v7 · 신뢰도 B · 기준 규모 $39.88B)` — resolution
 * label, version identity, ADR-0187 grade, anchor figure, and the confidence
 * basis (≤80 chars) when the version carries one. Returns null only when the
 * payload cannot be parsed for an anchor AND has no basis — never invents a
 * figure.
 */
export function s1ManifestLine(res: UniverseS1Resolution): string | null {
  const { row, resolution } = res;
  if (!row || resolution === "unset") return null;
  const label = S1_RESOLUTION_LABEL[resolution];
  const grade = row.data_confidence_grade ?? "미기록";
  const anchor = parseMatrix(row.payload).anchor?.total;
  const parts = [
    `${label} v${row.version_no}`,
    `신뢰도 ${grade}`,
    anchor != null ? `기준 규모 $${anchor.toFixed(2)}B` : "",
    row.confidence_basis ? `근거: ${row.confidence_basis.slice(0, 80)}` : "",
  ].filter(Boolean);
  return `S1 시장분석 (${parts.join(" · ")})`;
}

interface MatrixStructure {
  segments?: Array<{ code: string; label: string }>;
  regions?: Array<{ code: string; label?: string; weight?: number }>;
  chainGrade?: { grade?: string; statisticalHops?: number };
  chainDirection?: { position?: string; relatedIndustries?: Array<{ relation: string; name: string; note?: string }> };
  qualitative?: { opportunityFactors?: string[]; riskFactors?: string[] };
  sectionConfidence?: Array<{ section: string; grade: string }>;
}

/** The S1 sectionConfidence entry that grades the qualitative factor blocks. */
export const QUALITATIVE_SECTION = "정성 분석";

/** The full SizingMatrix-like structure slice the draft reads (segments,
 * regions, chain grade/direction, qualitative factors with section
 * confidence). Same tolerant parse as parseMatrix. */
export function parseMatrixStructure(payload: string): MatrixStructure {
  try {
    return (JSON.parse(payload) as { matrix?: MatrixStructure }).matrix ?? {};
  } catch {
    return {};
  }
}

/**
 * S1-declared structure lines (design §4.2) — segment structure, region mix,
 * value-chain position (chainGrade + chainDirection), and the qualitative
 * factor blocks each suffixed with the matching sectionConfidence grade when
 * present (the pipeline grades the qualitative section "정성 분석"). All
 * lines are additive: the caller puts each one in the user message AND the
 * manifest so the UI's proposal-artifact line stays truthful.
 */
export function s1StructureLines(payload: string): string[] {
  const m = parseMatrixStructure(payload);
  const lines: string[] = [];
  // 세그먼트: all segments, ≤6 shown plus a counted overflow line.
  const segs = m.segments ?? [];
  if (segs.length > 0) {
    const shown = segs.slice(0, 6).map((s) => `${s.label}(${s.code})`);
    if (segs.length > 6) shown.push(`외 ${segs.length - 6}건`);
    lines.push(`세그먼트: ${shown.join(" · ")}`);
  }
  // 지역 믹스: code + share%.
  const regions = (m.regions ?? []).filter((r) => r.weight != null);
  if (regions.length > 0) {
    lines.push(`지역 믹스: ${regions.map((r) => `${r.code} ${r.weight}%`).join(" · ")}`);
  }
  // 가치사슬 위치: chainGrade + chainDirection (an S6-declared input —
  // flow.spec S6 inputs include 시장 정의·가치사슬 구조).
  const cg = m.chainGrade;
  const cd = m.chainDirection;
  const pos = cd?.position;
  const related = (cd?.relatedIndustries ?? []).slice(0, 6).map((r) => `${r.relation} ${r.name}`);
  if (pos || cg) {
    const head = pos ? `가치사슬 위치: ${pos}` : "가치사슬 위치: 미기록";
    const grade = cg?.grade ? `(사슬 등급 ${cg.grade}, hops ${cg.statisticalHops ?? 0})` : "";
    const adj = related.length > 0 ? ` — 인접: ${related.join(" · ")}` : "";
    lines.push(`${head}${grade ? ` ${grade}` : ""}${adj}`.trimEnd());
  }
  // 기회/위험 요인: ≤5 each, suffixed with the matching sectionConfidence
  // grade when that section carries one.
  const sectionGrade = (section: string): string | null =>
    m.sectionConfidence?.find((e) => e.section === section)?.grade ?? null;
  const qualSuffix = (): string => {
    const g = sectionGrade(QUALITATIVE_SECTION);
    return g ? ` (섹션 신뢰도 ${g})` : "";
  };
  const opp = (m.qualitative?.opportunityFactors ?? []).slice(0, 5);
  const risk = (m.qualitative?.riskFactors ?? []).slice(0, 5);
  if (opp.length > 0) lines.push(`기회 요인: ${opp.join(" · ")}${qualSuffix()}`);
  if (risk.length > 0) lines.push(`위험 요인: ${risk.join(" · ")}${qualSuffix()}`);
  return lines;
}

/** One fact_industry row for the value-chain stage financials block. */
export interface StageFinancialRow {
  metric_key: string;
  value: number;
  revision_no: number;
  period_label: string;
}

/** Draft provenance (design §4.4) — always present on non-error envelopes;
 * the audit row has no metadata column, so the API response is the version
 * carrier. anchor_total_b is null when the payload carries no anchor or
 * cannot be parsed (never invented). */
export interface DraftProvenance {
  s1: {
    resolution: S1Resolution;
    version_id: string | null;
    version_no: number | null;
    data_confidence_grade: string | null;
    anchor_total_b: number | null;
  };
  chain_financials: "present" | "absent";
}

export function buildDraftProvenance(
  res: UniverseS1Resolution,
  chainFinancials: "present" | "absent",
): DraftProvenance {
  const { row, resolution } = res;
  return {
    s1: {
      resolution,
      version_id: row?.id ?? null,
      version_no: row?.version_no ?? null,
      data_confidence_grade: row?.data_confidence_grade ?? null,
      anchor_total_b: row ? (parseMatrix(row.payload).anchor?.total ?? null) : null,
    },
    chain_financials: chainFinancials,
  };
}

/**
 * Read the value-chain stage financials (ADR-0066 Phase A plane) for one
 * industry — read-only, bounded to ≤12 rows. md_period carries no label
 * column (migration 0001), so the period renders from fiscal_year. With 0
 * rows this is a no-op and the caller emits the honest gap line (§4.3).
 */
export function readStageFinancials(db: Database, industryId: string): StageFinancialRow[] {
  if (!industryId) return [];
  return db
    .query(
      `SELECT f.metric_key, f.value, f.revision_no, CAST(p.fiscal_year AS TEXT) AS period_label
       FROM fact_industry f
       JOIN md_period p ON p.id = f.period_id
       WHERE f.industry_id = ?
       ORDER BY f.period_id, f.metric_key
       LIMIT 12`,
    )
    .all(industryId) as StageFinancialRow[];
}

/** The gap line naming the producing S1 activity (design §4.2/§4.3 exact
 * wording) — emitted when fact_industry has no rows for the industry. */
export const STAGE_FINANCIALS_GAP_LINE =
  "가치사슬 단계별 재무: 데이터 없음 — S1의 가치사슬 단계 재무 분석(value-chain-stage-financials, ADR-0066)이 산출하면 자동 반영";

export function stageFinancialsLines(rows: StageFinancialRow[]): string[] {
  if (rows.length === 0) return [STAGE_FINANCIALS_GAP_LINE];
  // Latest period per metric (the query is period-ordered; keep the last
  // occurrence of each metric_key within the ≤12-row bound).
  const latest = new Map<string, StageFinancialRow>();
  for (const r of rows) latest.set(r.metric_key, r);
  return [...latest.values()].map(
    (r) => `단계 재무: ${r.metric_key}=${r.value} (${r.period_label}, rev${r.revision_no})`,
  );
}

/**
 * Full S3 capability rows (design §4.2 last row) — per row:
 * `<capability> (필요수준 <requiredLevel> · 보유 <heldStatus> · 필요성
 * <necessity><scopeNote 있으면 · <necessityScopeNote>>) — <requiredNote
 * ≤200자>`. Names are capped at 80 chars (no 60-char truncation) and the
 * requiredNote is carried; ≤12 rows plus a counted overflow line.
 */
export function s3CapabilityLines(registerJson: string | null): { lines: string[]; total: number } {
  if (!registerJson) return { lines: [], total: 0 };
  let rows: Array<{
    capability?: string;
    requiredLevel?: string;
    requiredNote?: string;
    necessity?: string;
    necessityScopeNote?: string;
    held?: { status?: string };
  }> = [];
  try {
    rows = (JSON.parse(registerJson) as { rows?: typeof rows }).rows ?? [];
  } catch {
    return { lines: [], total: 0 };
  }
  const total = rows.length;
  const heldLabel = (s: string | undefined): string =>
    s === "leading"
      ? "업계 리딩"
      : s === "average"
        ? "업계 평균"
        : s === "partial"
          ? "부분 보유"
          : s === "none"
            ? "미보유"
            : "미판정";
  const necessityLabel = (s: string | undefined): string =>
    s === "essential" ? "필수" : s === "partial_essential" ? "부분 필수" : s === "optional" ? "선택" : "미정";
  const lines = rows.slice(0, 12).map((r) => {
    const name = (r.capability ?? "").trim().slice(0, 80);
    const scopeNote = r.necessityScopeNote?.trim();
    const note = (r.requiredNote ?? "").trim().slice(0, 200);
    const head = [
      `필요수준 ${(r.requiredLevel ?? "").trim()}`,
      `보유 ${heldLabel(r.held?.status)}`,
      `필요성 ${necessityLabel(r.necessity)}${scopeNote ? ` · ${scopeNote.trim().slice(0, 120)}` : ""}`,
    ].join(" · ");
    return `${name} (${head})${note ? ` — ${note}` : ""}`;
  });
  if (total > 12) lines.push(`외 ${total - 12}건`);
  return { lines, total };
}

// ── S6 direction review: evidence catalog + text rules (design
//    2026-11-17-s6-universe-direction-review §4.1, §5.2) ──
// Korean rule literals live in universe-direction-rules.json (the i18n baseline
// holds); every fact is English-coded and the UI localizes.

/** The unverified marker the prompt pins in its Language section. */
export const UNVERIFIED_MARKER: string = rules.marker;
/** Derivation narration — banned in conclusion fields (not in the basis line). */
export const DERIVATION_PATTERNS: RegExp[] = rules.derivation.map((p) => new RegExp(p));
/** Source naming and disclaimer leakage — banned in every visible field. */
export const SOURCE_LEAK_PATTERNS: RegExp[] = rules.sourceLeak.map((p) => new RegExp(p));
/** Capability conditions — banned in scope and exclude lines only. */
export const CAPABILITY_PATTERN = new RegExp(rules.capability);
/** Units that make a small integer a quantity (not a count) when it follows one. */
export const NUMBER_UNITS: string = rules.numberUnits;

export const GRADE_ORDER: readonly Grade[] = ["A", "B", "B-", "C", "C-", "D", "U"];

export function parseGrade(g: unknown): Grade | null {
  return typeof g === "string" && (GRADE_ORDER as readonly string[]).includes(g) ? (g as Grade) : null;
}

/** Which direction fields may cite each evidence kind (design §3 table; the
 * CAGR and projection kinds are basis/support only, so a growth number can
 * never become a scope criterion). */
export const KIND_CITEABLE: Record<EvidenceKind, CiteField[]> = {
  s1_identity: ["scope", "basis"],
  s1_anchor: ["scope", "basis", "support"],
  s1_trend_cagr: ["basis", "support"],
  s1_topdown_cagr: ["basis", "support"],
  s1_external_forecast: ["basis", "support"],
  s1_projection: ["basis", "support"],
  s1_competitive: ["priority", "exclude", "basis"],
  s1_chain: ["value_chain", "priority", "exclude", "basis"],
  s1_region_mix: ["scope", "priority", "exclude", "basis"],
  s1_segments: ["scope", "value_chain", "priority", "exclude", "basis"],
  s1_opportunity_factor: ["priority", "exclude", "basis"],
  s1_risk_factor: ["priority", "exclude", "basis"],
  stage_financial: ["value_chain", "priority", "exclude", "basis", "support"],
  stage_financial_gap: ["value_chain", "priority", "exclude", "basis", "support"],
  s3_capability: ["priority", "basis"],
};

export interface NumberToken {
  token: string;
  /** Absolute value (comma-stripped) — tracing is sign-insensitive. */
  value: number;
  decimals: number;
  start: number;
  end: number;
}

const NUMBER_RE = /[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-+]?\d+(?:\.\d+)?/g;

/** Numeric tokens of a text (design old §6.3). A sign glued to a preceding
 * word or digit (`2026-2031`, `A-3`) is a separator, not a sign. */
export function tokenizeNumbers(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    let raw = m[0];
    let start = m.index ?? 0;
    if ((raw[0] === "-" || raw[0] === "+") && start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1])) {
      raw = raw.slice(1);
      start += 1;
    }
    const clean = raw.replace(/^[-+]/, "").replace(/,/g, "");
    out.push({
      token: clean,
      value: Number(clean),
      decimals: clean.includes(".") ? clean.length - clean.indexOf(".") - 1 : 0,
      start,
      end: start + raw.length,
    });
  }
  return out;
}

export const roundTo = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;

/** `numbers` of an evidence item: every token of the fact, its percent→fraction
 * equivalent when a `%` follows, caller-supplied raw values (fractions and
 * their percent form), each also rounded to 0, 1 and 2 decimals. */
export function deriveNumbers(fact: string, raw: number[] = []): number[] {
  const set = new Set<number>();
  const add = (v: number) => {
    set.add(v);
    for (const d of [0, 1, 2]) set.add(roundTo(v, d));
  };
  for (const t of tokenizeNumbers(fact)) {
    add(t.value);
    if (fact[t.end] === "%") add(t.value / 100);
  }
  for (const r of raw) {
    add(Math.abs(r));
    add(Math.abs(r) * 100);
  }
  return [...set].sort((a, b) => a - b);
}

export function yearsOf(fact: string): number[] {
  return [
    ...new Set(
      tokenizeNumbers(fact)
        .filter((t) => t.decimals === 0 && t.value >= 1990 && t.value <= 2100 && t.token.length === 4)
        .map((t) => t.value),
    ),
  ];
}

interface CatalogMatrix extends MatrixStructure {
  industryLabel?: string;
  anchor?: { total?: number };
  competitive?: { structure?: string };
  consistency?: { bottomUpCagr?: number; topDownCagr?: number; source?: { label?: string } };
  externalForecast?: { sourceLabel?: string; targetYear?: number; marketSize?: number; cagr?: number };
  calibration?: { ourCagrPct?: number | null };
  baseline2026?: Record<string, Record<string, number>>;
  cagrBase?: Record<string, Record<string, number>>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fmt = (n: number): string => String(Number(n.toFixed(2)));

/**
 * The numbered evidence catalog (design 2026-11-17 §4.1). Pure: the route
 * passes the resolved S1 row, the stage-financial rows and the raw S3 register.
 * Ids are assigned in fixed kind order; an absent payload field creates no
 * item, so the model cannot cite what does not exist.
 */
export function buildUniverseEvidenceCatalog(
  s1: UniverseS1Resolution,
  stageFinancialRows: StageFinancialRow[],
  capabilityRegister: string | null,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const push = (
    kind: EvidenceKind,
    ref: string,
    versionId: string | null,
    fact: string,
    grade: Grade | null,
    extra: { raw?: number[]; support?: string } = {},
  ) => {
    const text = fact.slice(0, 200);
    items.push({
      id: `E${items.length + 1}`,
      kind,
      ref,
      version_id: versionId,
      fact: text,
      grade,
      numbers: deriveNumbers(text, extra.raw),
      years: yearsOf(text),
      citeable_in: KIND_CITEABLE[kind],
      ...(extra.support ? { support_value: extra.support } : {}),
    });
  };
  const { row, resolution } = s1;
  if (row && resolution !== "unset") {
    const m = (() => {
      try {
        return ((JSON.parse(row.payload) as { matrix?: CatalogMatrix }).matrix ?? {}) as CatalogMatrix;
      } catch {
        return {} as CatalogMatrix;
      }
    })();
    const ref = `S1 v${row.version_no}`;
    const vGrade = parseGrade(row.data_confidence_grade);
    const add = (kind: EvidenceKind, fact: string, grade: Grade | null = vGrade, extra = {}) =>
      push(kind, ref, row.id, fact, grade, extra);
    add("s1_identity", `Industry definition: ${m.industryLabel ?? "unknown"} (${resolution} v${row.version_no})`);
    const total = m.anchor?.total;
    if (isNum(total)) {
      add("s1_anchor", `Anchor market size $${total.toFixed(2)}B (2026, global)`, vGrade, {
        support: `$${total.toFixed(2)}B (2026)`,
      });
    }
    const bottomUp = m.consistency?.bottomUpCagr;
    const trendPct = isNum(m.calibration?.ourCagrPct)
      ? m.calibration.ourCagrPct
      : isNum(bottomUp)
        ? bottomUp * 100
        : null;
    if (trendPct !== null) {
      add("s1_trend_cagr", `Trend-extension CAGR ${fmt(trendPct)}% (past growth extended, bottom-up)`, vGrade, {
        raw: [trendPct / 100],
        support: `${fmt(trendPct)}%`,
      });
    }
    const topDown = m.consistency?.topDownCagr;
    if (isNum(topDown)) {
      const src = m.consistency?.source?.label;
      add("s1_topdown_cagr", `Top-down CAGR ${fmt(topDown * 100)}%${src ? ` (${src})` : ""}`, vGrade, {
        raw: [topDown],
        support: `${fmt(topDown * 100)}%`,
      });
    }
    const ef = m.externalForecast;
    if (ef && isNum(ef.marketSize) && isNum(ef.targetYear)) {
      const cagrPart = isNum(ef.cagr) ? `, CAGR ${fmt(ef.cagr * 100)}%` : "";
      add(
        "s1_external_forecast",
        `External forecast ${ef.sourceLabel ?? "source"}: ${ef.targetYear} $${fmt(ef.marketSize)}B${cagrPart}`,
        vGrade,
        {
          raw: isNum(ef.cagr) ? [ef.cagr] : [],
          ...(isNum(ef.cagr) ? { support: `${fmt(ef.cagr * 100)}%` } : {}),
        },
      );
    }
    let projection = 0;
    for (const [region, segs] of Object.entries(m.baseline2026 ?? {})) {
      for (const [seg, base] of Object.entries(segs ?? {})) {
        if (isNum(base)) projection += base * (1 + (m.cagrBase?.[region]?.[seg] ?? 0)) ** 4;
      }
    }
    if (projection > 0) {
      push(
        "s1_projection",
        `${ref} (computed)`,
        row.id,
        `2030 base-scenario projection $${projection.toFixed(2)}B (computed: 2026 baseline compounded at cell base CAGR)`,
        vGrade,
      );
    }
    if (m.competitive?.structure) add("s1_competitive", `Competitive structure: ${m.competitive.structure}`);
    const cg = m.chainGrade;
    const pos = m.chainDirection?.position;
    if (pos || cg?.grade) {
      const chain = cg?.grade ? ` (chain grade ${cg.grade}, hops ${cg.statisticalHops ?? 0})` : "";
      add(
        "s1_chain",
        `Value-chain position: ${pos ?? "unrecorded"}${chain}`,
        cg?.grade ? parseGrade(cg.grade) : vGrade,
      );
    }
    const regions = (m.regions ?? []).filter((r) => r.weight != null);
    if (regions.length > 0)
      add("s1_region_mix", `Region mix: ${regions.map((r) => `${r.code} ${r.weight}%`).join(" · ")}`);
    const segs = m.segments ?? [];
    if (segs.length > 0) {
      const shown = segs.slice(0, 6).map((s) => s.label);
      if (segs.length > 6) shown.push(`+${segs.length - 6} more`);
      add("s1_segments", `Segments: ${shown.join(" · ")}`);
    }
    const qualGrade = parseGrade(m.sectionConfidence?.find((e) => e.section === QUALITATIVE_SECTION)?.grade) ?? vGrade;
    for (const text of (m.qualitative?.opportunityFactors ?? []).slice(0, 3)) {
      add("s1_opportunity_factor", `Opportunity factor: ${text}`, qualGrade);
    }
    for (const text of (m.qualitative?.riskFactors ?? []).slice(0, 3))
      add("s1_risk_factor", `Risk factor: ${text}`, qualGrade);
    if (stageFinancialRows.length === 0) {
      push("stage_financial_gap", "Stage financials", null, "Value-chain stage financials: no data", null, {
        support: "unverified",
      });
    } else {
      const latest = new Map<string, StageFinancialRow>();
      for (const r of stageFinancialRows) latest.set(r.metric_key, r);
      for (const r of [...latest.values()].slice(0, 4)) {
        push(
          "stage_financial",
          "Stage financials",
          null,
          `Stage financial: ${r.metric_key}=${r.value} (${r.period_label}, rev${r.revision_no})`,
          null,
          {
            support: `${r.metric_key}=${r.value}`,
          },
        );
      }
    }
  }
  for (const c of s3Capabilities(capabilityRegister)) {
    push("s3_capability", "S3 capability register", null, `S3 required capability: ${c.name} (${c.level})`, null);
  }
  return items;
}

/** Up to 5 capability rows from the S3 register, required rows first. */
function s3Capabilities(registerJson: string | null): Array<{ name: string; level: "required" | "optional" }> {
  if (!registerJson) return [];
  let rows: Array<{ capability?: string; necessity?: string }> = [];
  try {
    rows = (JSON.parse(registerJson) as { rows?: typeof rows }).rows ?? [];
  } catch {
    return [];
  }
  const all = rows
    .map((r) => ({
      name: (r.capability ?? "").trim().slice(0, 80),
      level:
        r.necessity === "essential" || r.necessity === "partial_essential"
          ? ("required" as const)
          : ("optional" as const),
    }))
    .filter((r) => r.name);
  return [...all.filter((r) => r.level === "required"), ...all.filter((r) => r.level === "optional")].slice(0, 5);
}
