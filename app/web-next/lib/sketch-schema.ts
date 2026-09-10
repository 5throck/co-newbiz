// Sketch JSON v2 schema — the business-model-canvas + ERRC integrated sketch
// (docs/designs workflow: 목업 bms-v2.html 확정안). Stored in
// opportunity.sketch_json as `{ schema: 2, ... }`; legacy rows (no schema
// field, the v1 six-field shape) are rendered by the caller's text fallback.
//
// v2 shape:
//   canvas: 9 BMC blocks; each item is { text, action?, why? } where action is
//           one of the Blue Ocean ERRC actions — the item's blue-ocean move.
//   marketEntry / scenarios / keyRisks: carried over from v1.

export type ErrcAction = "eliminate" | "reduce" | "raise" | "create";

export interface SketchItem {
  text: string;
  action?: ErrcAction;
  why?: string;
}

export type SketchBlockKey =
  | "keyPartners"
  | "keyActivities"
  | "keyResources"
  | "valuePropositions"
  | "customerRelationships"
  | "channels"
  | "customerSegments"
  | "costStructure"
  | "revenueStreams";

export interface SketchV2 {
  schema: 2;
  canvas: Record<SketchBlockKey, SketchItem[]>;
  /** 블록 배치 위치를 특정할 수 없는 ERRC 항목의 보관 영역 (선택). */
  errc?: Partial<Record<ErrcAction, Array<{ item: string; why?: string }>>>;
  marketEntry: string[];
  scenarios: Array<{ name: string; assumption: string }>;
  keyRisks: string[];
}

export const SKETCH_BLOCK_LABELS: Record<SketchBlockKey, string> = {
  keyPartners: "핵심 파트너",
  keyActivities: "핵심 활동",
  keyResources: "핵심 자원",
  valuePropositions: "가치 제안",
  customerRelationships: "고객 관계",
  channels: "채널",
  customerSegments: "고객 세그먼트",
  costStructure: "비용 구조",
  revenueStreams: "수익 스트림",
};

export const SKETCH_BLOCKS: SketchBlockKey[] = [
  "keyPartners", "keyActivities", "keyResources", "valuePropositions",
  "customerRelationships", "channels", "customerSegments",
  "costStructure", "revenueStreams",
];

const ERRC_ACTIONS: ErrcAction[] = ["eliminate", "reduce", "raise", "create"];

/** Coerce an unknown scalar into a trimmed string — "" when not coercible. */
const str = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
};

const strArr = (v: unknown, cap = 8): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, cap)
    : typeof v === "string" && v.trim() !== ""
      ? [v.trim()]
      : [];

/** Coerce one LLM item (string or {text,action,why}) into a normalized SketchItem. */
function toItem(v: unknown): SketchItem | null {
  if (typeof v === "string") {
    return v.trim() !== "" ? { text: v.trim() } : null;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const text = str(o.text ?? o.item ?? o.value);
    if (!text) return null;
    const action = ERRC_ACTIONS.includes(o.action as ErrcAction) ? (o.action as ErrcAction) : undefined;
    const why = typeof o.why === "string" && o.why.trim() !== "" ? o.why.trim() : undefined;
    return action ? { text, action, why: why ?? "" } : { text, ...(why ? { why } : {}) };
  }
  return null;
}

/**
 * Normalize an LLM-produced sketch into SketchV2 — tolerant of missing blocks
 * and of string-vs-object items; drops unknown ERRC actions; caps item counts
 * so a verbose generation cannot blow up the canvas. Deterministic: same input
 * always yields the same output.
 */
export function normalizeSketchV2(raw: unknown): SketchV2 {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawCanvas = (o.canvas && typeof o.canvas === "object" ? o.canvas : {}) as Record<string, unknown>;
  const canvas = {} as Record<SketchBlockKey, SketchItem[]>;
  for (const key of SKETCH_BLOCKS) {
    const items = Array.isArray(rawCanvas[key]) ? rawCanvas[key] : [];
    canvas[key] = items
      .map(toItem)
      .filter((x): x is SketchItem => x !== null)
      .slice(0, 6);
  }
  const rawErrc = (o.errc && typeof o.errc === "object" ? o.errc : {}) as Record<string, unknown>;
  // v2 allows ERRC as a separate object too — fold its items back into the
  // blocks is not possible without placement hints, so it is preserved as a
  // top-level companion the UI renders under the canvas when present.
  const errc: Partial<Record<ErrcAction, Array<{ item: string; why?: string }>>> = {};
  for (const action of ERRC_ACTIONS) {
    const list = rawErrc[action];
    if (Array.isArray(list) && list.length > 0) {
      errc[action] = list
        .map(toItem)
        .filter((x): x is SketchItem => x !== null)
        .slice(0, 4)
        .map((x) => ({ item: x.text, ...(x.why ? { why: x.why } : {}) }));
    }
  }
  const scenarios = (Array.isArray(o.scenarios) ? o.scenarios : [])
    .map((s) => {
      const sc = (s ?? {}) as Record<string, unknown>;
      const name = typeof sc.name === "string" ? sc.name.trim() : "";
      const assumption = typeof sc.assumption === "string" ? sc.assumption.trim() : "";
      return { name, assumption };
    })
    .filter((s) => s.name !== "" || s.assumption !== "")
    .slice(0, 3);
  return {
    schema: 2,
    canvas,
    ...(Object.keys(errc).length > 0 ? { errc } : {}),
    marketEntry: strArr(o.marketEntry, 6),
    scenarios,
    keyRisks: strArr(o.keyRisks, 8),
  } as SketchV2;
}

/** Detect the stored sketch's schema version — legacy rows render as text. */
export function sketchSchema(sketch: unknown): 2 | 1 {
  return sketch && typeof sketch === "object" && (sketch as Record<string, unknown>).schema === 2 ? 2 : 1;
}
