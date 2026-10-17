// Shared tolerant readers for a market_sizing_version payload (ADR-0180
// slice 1). The sizing pipeline writes {methodology, matrix: {anchor, regions,
// segments, scope?…}, stepSummaries} (lib/market-sizing-pipeline.ts), while
// the ADR-0179 readers were built against the top-level {anchor, regions,
// scope} shape — so on every real payload the anchor/scope/regions reads came
// back null and the whole entry-market flow was inert (verified 2026-10-17:
// 12/12 live rows carry the nested shape, 0 carry a top-level anchor). These
// readers accept BOTH shapes — top-level first (the shape the tests and any
// future top-level writer use), then the nested matrix shape — and every
// ADR-0179 reader delegates here. Payloads are never rewritten; stored rows
// stay byte-identical.
//
// Every function is tolerant by contract: unparsable JSON or a missing/
// malformed field yields null ([]) rather than a throw, mirroring the
// defensive reads this module replaces.

export interface SizingRegion {
  code: string;
  label: string;
  weight: number;
  mix?: Record<string, number>;
}

export interface SizingDeclaredScope {
  regions: string[];
  segments: string[];
  unit_basis: string | null;
}

function parsePayload(payload: string | null | undefined): Record<string, unknown> | null {
  if (payload == null || payload === "") return null;
  try {
    const data = JSON.parse(payload) as unknown;
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

function matrixOf(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!payload) return null;
  const matrix = payload.matrix;
  if (typeof matrix !== "object" || matrix === null || Array.isArray(matrix)) return null;
  return matrix as Record<string, unknown>;
}

/** The year-1 anchor total: `anchor.total` at the top level, then
 *  `matrix.anchor.total` (the pipeline's shape). A positive finite number
 *  only; null otherwise. */
export function readSizingAnchorTotal(payload: string | null | undefined): number | null {
  const root = parsePayload(payload);
  if (!root) return null;
  for (const holder of [root, matrixOf(root)]) {
    const anchor = holder?.anchor;
    if (typeof anchor !== "object" || anchor === null) continue;
    const total = (anchor as Record<string, unknown>).total;
    if (typeof total === "number" && Number.isFinite(total) && total > 0) return total;
  }
  return null;
}

/** The declared scope (ADR-0179 §5.1 version-payload `scope` object):
 *  top-level, then `matrix.scope` (where a future scoped sizing is expected to
 *  carry it). Preserves the strict shape rules of extractSizingVersionScope —
 *  a scope without non-empty string regions is not a scope. */
export function readSizingDeclaredScope(payload: string | null | undefined): SizingDeclaredScope | null {
  const root = parsePayload(payload);
  if (!root) return null;
  for (const holder of [root, matrixOf(root)]) {
    const scope = holder?.scope;
    if (typeof scope !== "object" || scope === null) continue;
    const s = scope as Record<string, unknown>;
    if (!Array.isArray(s.regions) || s.regions.length === 0 || !s.regions.every((r) => typeof r === "string" && r.length > 0)) {
      continue;
    }
    const segments = Array.isArray(s.segments) ? s.segments.filter((x): x is string => typeof x === "string") : [];
    return {
      regions: s.regions as string[],
      segments,
      unit_basis: typeof s.unit_basis === "string" ? s.unit_basis : null,
    };
  }
  return null;
}

/** The matrix region weights (`regions[]` with code/label/weight and the
 *  optional segment `mix`): top-level, then `matrix.regions`. Malformed rows
 *  are dropped, never a throw. */
export function readSizingRegions(payload: string | null | undefined): SizingRegion[] {
  const root = parsePayload(payload);
  if (!root) return [];
  for (const holder of [root, matrixOf(root)]) {
    const regions = holder?.regions;
    if (!Array.isArray(regions)) continue;
    const out: SizingRegion[] = [];
    for (const r of regions) {
      if (typeof r !== "object" || r === null) continue;
      const row = r as Record<string, unknown>;
      if (typeof row.code !== "string" || typeof row.label !== "string" || typeof row.weight !== "number") continue;
      const region: SizingRegion = { code: row.code, label: row.label, weight: row.weight };
      if (typeof row.mix === "object" && row.mix !== null && !Array.isArray(row.mix)) {
        const mix: Record<string, number> = {};
        for (const [k, v] of Object.entries(row.mix as Record<string, unknown>)) {
          if (typeof v === "number") mix[k] = v;
        }
        region.mix = mix;
      }
      out.push(region);
    }
    if (out.length > 0) return out;
  }
  return [];
}

/** The matrix's segment labels (`segments[]` with code/label when present). */
export function readSizingSegments(payload: string | null | undefined): Array<{ code: string; label: string }> {
  const root = parsePayload(payload);
  if (!root) return [];
  for (const holder of [root, matrixOf(root)]) {
    const segments = holder?.segments;
    if (!Array.isArray(segments)) continue;
    const out: Array<{ code: string; label: string }> = [];
    for (const s of segments) {
      if (typeof s !== "object" || s === null) continue;
      const row = s as Record<string, unknown>;
      if (typeof row.code === "string" && typeof row.label === "string") out.push({ code: row.code, label: row.label });
    }
    if (out.length > 0) return out;
  }
  return [];
}

export interface SizingRegionTrend {
  region: string;
  segments: Array<{ code: string; baseline: number | null; cagr: number | null }>;
}

/** Per-region segment baseline (baseline2026) and CAGR (cagrBase, FRACTION —
 *  the pipeline stores ratios, lib/market-sizing.ts) for the given region
 *  codes — the raw material of the 진입시장 동향 card and the AI growth
 *  proposal (ADR-0181 slice 2). Case-insensitive region match (matrix region
 *  key casing varies across sizings); missing regions are simply absent.
 *  S1 is FROZEN — this only READS the payload. */
export function readSizingRegionTrends(payload: string | null | undefined, regions: readonly string[]): SizingRegionTrend[] {
  const root = parsePayload(payload);
  if (!root) return [];
  const matrix = matrixOf(root);
  if (!matrix) return [];
  // baseline2026/cagrBase are TWO-level maps (region → segment → value);
  // keys are lower-cased for case-insensitive region/segment matching.
  const pickTwoLevel = (v: unknown): Record<string, Record<string, number>> | null => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const out: Record<string, Record<string, number>> = {};
    for (const [region, segVal] of Object.entries(v as Record<string, unknown>)) {
      if (typeof segVal !== "object" || segVal === null || Array.isArray(segVal)) continue;
      const segs: Record<string, number> = {};
      for (const [seg, n] of Object.entries(segVal as Record<string, unknown>)) {
        if (typeof n === "number") segs[seg.toLowerCase()] = n;
      }
      if (Object.keys(segs).length > 0) out[region.toLowerCase()] = segs;
    }
    return Object.keys(out).length > 0 ? out : null;
  };
  const baseline = pickTwoLevel(matrix.baseline2026);
  const cagr = pickTwoLevel(matrix.cagrBase);
  if (!baseline && !cagr) return [];
  const lower = regions.map((r) => r.toLowerCase());
  const out: SizingRegionTrend[] = [];
  for (const region of lower) {
    // baseline2026/cagrBase are TWO-level maps (region → segment → value);
    // the region lookup yields the segment record, not a number.
    const segBaseline: Record<string, number> | null = baseline?.[region] ?? null;
    const segCagr: Record<string, number> | null = cagr?.[region] ?? null;
    if (!segBaseline && !segCagr) continue;
    const codes = new Set([...(segBaseline ? Object.keys(segBaseline) : []), ...(segCagr ? Object.keys(segCagr) : [])]);
    out.push({
      region,
      segments: [...codes].map((code) => ({
        code,
        baseline: segBaseline?.[code] ?? null,
        cagr: segCagr?.[code] ?? null,
      })),
    });
  }
  return out;
}
