// ADR-0194 item A, reshaped to overall-viability-first by ADR-0201 (design 2026-11-17-deal-shape-viability-first §6):
// view logic of the deal-shape evaluation panel. Pure data mapping, no React: the panel renders these results, tests pin them.
// A verdict is a human-recorded fact. The form starts empty; the only values it can load are the person's own recorded verdict
// (`formFromLive`) or an AI proposal the person explicitly applies (`formFromRecommendation`). Nothing here saves anything.

export interface DealShapeRow {
  id: string;
  opportunity_id: string;
  /** null on the overall "no shape is viable" row. */
  shape: string | null;
  intent: string | null;
  viable: boolean;
  rationale: string;
  evidence_ref: string | null;
  evaluated_by: string;
  evaluated_at: string;
  superseded_by: string | null;
}

export type DealShapeVerdict = "unassessed" | "not_viable" | "viable";

export interface DealShapeData {
  opportunity_id: string;
  verdict?: DealShapeVerdict;
  /** The live overall "no shape is viable" row, or null. */
  overall?: DealShapeRow | null;
  /** Live SHAPE rows only (legacy viable = false rows included until the next write supersedes them). */
  live: DealShapeRow[];
  /** Superseded rows of both kinds, newest first. */
  history: DealShapeRow[];
  unselected_shapes?: string[];
  /** ADR-0201: token of the live set, echoed by every write (replace-the-set concurrency guard). */
  live_token?: string;
  /** null = nothing recorded: kill criterion #9 stays unassessed (never "zero viable"). */
  viable_count: number | null;
  vocabulary: { shapes: string[]; intents: string[] };
}

export const RATIONALE_MAX = 2000;
export const EVIDENCE_MAX = 2000;

/** The kill criterion this panel feeds, as the snapshot's acknowledgement key (`<procedure>:<criterion_id>`). */
export const DEAL_SHAPE_KILL_KEY = "deal-shape-chain:no_viable_deal_shape";

/** Anchor on the S7 target-screening screen where the panel mounts (the #9 snapshot link targets it). */
export const DEAL_SHAPE_PANEL_ID = "deal-shape-panel";

/** The server's verdict wins; an older payload without it is derived from the rows (never from a null count read as zero). */
export function verdictOf(data: Pick<DealShapeData, "verdict" | "overall" | "live">): DealShapeVerdict {
  if (data.verdict) return data.verdict;
  if (data.live.some((r) => r.viable)) return "viable";
  return data.overall || data.live.length > 0 ? "not_viable" : "unassessed";
}

export interface ShapeDraft {
  rationale: string;
  evidenceRef: string;
}

export interface DealShapeForm {
  /** null until a person picks: there is no default verdict. */
  viable: boolean | null;
  /** Not-viable branch: one overall rationale, no shape, no intent. */
  rationale: string;
  evidenceRef: string;
  /** Viable branch: the checked shapes (any order; sent in vocabulary order), one intent, one rationale per checked shape. */
  shapes: string[];
  intent: string;
  /** Kept in memory when a shape is unchecked or the branch is switched; only checked shapes are ever sent. */
  drafts: Record<string, ShapeDraft>;
}

export const EMPTY_DEAL_SHAPE_FORM: DealShapeForm = {
  viable: null,
  rationale: "",
  evidenceRef: "",
  shapes: [],
  intent: "",
  drafts: {},
};

export const draftOf = (f: Pick<DealShapeForm, "drafts">, shape: string): ShapeDraft =>
  f.drafts[shape] ?? { rationale: "", evidenceRef: "" };

/** True when the form holds no restored content — the "recorded evaluation loaded" note must not
 *  appear for a blank form (legacy zero-viable set with no overall verdict, review finding #18). */
export function formIsEmpty(f: Pick<DealShapeForm, "viable" | "rationale" | "shapes" | "drafts">): boolean {
  return f.viable === null && f.rationale === "" && f.shapes.length === 0 && Object.keys(f.drafts).length === 0;
}

/** Checked shapes in vocabulary order (unknown codes last, in checked order). */
export function orderedShapes(f: Pick<DealShapeForm, "shapes">, order: readonly string[]): string[] {
  const rank = (s: string) => (order.indexOf(s) === -1 ? order.length : order.indexOf(s));
  return [...f.shapes].sort((a, b) => rank(a) - rank(b));
}

/** Loads the person's own RECORDED live verdict into the form (the 수정 button); mixed legacy intents leave the intent empty. */
export function formFromLive(data: Pick<DealShapeData, "live" | "overall">): DealShapeForm {
  const viableRows = data.live.filter((r) => r.viable && r.shape);
  if (viableRows.length > 0) {
    const intents = new Set(viableRows.map((r) => r.intent ?? ""));
    return {
      ...EMPTY_DEAL_SHAPE_FORM,
      viable: true,
      shapes: viableRows.map((r) => r.shape as string),
      intent: intents.size === 1 ? [...intents][0] : "",
      drafts: Object.fromEntries(
        viableRows.map((r) => [r.shape as string, { rationale: r.rationale, evidenceRef: r.evidence_ref ?? "" }]),
      ),
    };
  }
  if (data.overall)
    return {
      ...EMPTY_DEAL_SHAPE_FORM,
      viable: false,
      rationale: data.overall.rationale,
      evidenceRef: data.overall.evidence_ref ?? "",
    };
  return EMPTY_DEAL_SHAPE_FORM;
}

/** The AI proposal in the same structure as the form: overall verdict first, shapes only when viable (ADR-0201 §7). */
export interface DealShapeRecommendation {
  overall_viable: boolean | null;
  intent: string;
  rationale: string;
  shapes: { shape: string; rationale: string }[];
}

/** A proposal only fills the form (never saves); the person edits and records. */
export function formFromRecommendation(r: DealShapeRecommendation): DealShapeForm {
  if (r.overall_viable === true)
    return {
      ...EMPTY_DEAL_SHAPE_FORM,
      viable: true,
      intent: r.intent,
      shapes: r.shapes.map((s) => s.shape),
      drafts: Object.fromEntries(r.shapes.map((s) => [s.shape, { rationale: s.rationale, evidenceRef: "" }])),
    };
  if (r.overall_viable === false) return { ...EMPTY_DEAL_SHAPE_FORM, viable: false, rationale: r.rationale };
  return EMPTY_DEAL_SHAPE_FORM;
}

export type FormProblem =
  | "viable"
  | "rationale"
  | "rationaleTooLong"
  | "shapes"
  | "intent"
  | "evidenceTooLong"
  | `shapeRationale:${string}`
  | `shapeRationaleTooLong:${string}`;

/** Early client check; the server stays authoritative. Order = field order on screen. */
export function validateDealShapeForm(f: DealShapeForm, order: readonly string[]): FormProblem | null {
  if (f.viable === null) return "viable";
  if (f.viable === false) {
    const rationale = f.rationale.trim();
    if (!rationale) return "rationale";
    if (rationale.length > RATIONALE_MAX) return "rationaleTooLong";
    if (f.evidenceRef.trim().length > EVIDENCE_MAX) return "evidenceTooLong";
    return null;
  }
  if (f.shapes.length === 0) return "shapes";
  if (!f.intent) return "intent";
  const shapes = orderedShapes(f, order);
  for (const s of shapes) {
    const rationale = draftOf(f, s).rationale.trim();
    if (!rationale) return `shapeRationale:${s}`;
    if (rationale.length > RATIONALE_MAX) return `shapeRationaleTooLong:${s}`;
  }
  if (shapes.some((s) => draftOf(f, s).evidenceRef.trim().length > EVIDENCE_MAX)) return "evidenceTooLong";
  return null;
}

export type DealShapeBody =
  | { viable: false; rationale: string; evidence_ref?: string; live_token: string }
  | {
      viable: true;
      intent: string;
      shapes: { shape: string; rationale: string; evidence_ref?: string }[];
      live_token: string;
    };

/**
 * The ADR-0201 §5.2 union. No evaluator field (the server takes the session user); optional evidence is omitted when blank;
 * only the active branch is sent (a not-viable body carries no shape and no intent, a viable body no overall rationale).
 */
export function buildDealShapeBody(f: DealShapeForm, liveToken: string, order: readonly string[]): DealShapeBody {
  if (f.viable === true)
    return {
      viable: true,
      intent: f.intent,
      shapes: orderedShapes(f, order).map((shape) => {
        const d = draftOf(f, shape);
        const evidence = d.evidenceRef.trim();
        return { shape, rationale: d.rationale.trim(), ...(evidence ? { evidence_ref: evidence } : {}) };
      }),
      live_token: liveToken,
    };
  const evidence = f.evidenceRef.trim();
  return {
    viable: false,
    rationale: f.rationale.trim(),
    ...(evidence ? { evidence_ref: evidence } : {}),
    live_token: liveToken,
  };
}

export type DealShapeErrorKind =
  | "viewer"
  | "admin"
  | "notFound"
  | "invalid"
  | "notOpen"
  | "notOpenStage"
  | "notOpenTrack"
  | "stale"
  | "tooLarge"
  | "conflict"
  | "other";

/**
 * Maps the route's error envelope to a message kind (400 invalid_request, 403 role_required / role_forbidden, 404,
 * 409 deal_shape_stale / deal_shape_not_open, 413). Any other 409 is shown with the server's own message ("conflict"),
 * so a renamed code still reads correctly.
 *
 * design 2026-11-21-s67-completion-visibility Fix ①-c: a 409 deal_shape_not_open carries the guard's machine
 * reason in `details.reason` (dealShapeWriteGuard) — the UI names track vs stage instead of one generic sentence.
 * `details` is optional and old two-arg calls keep working: a missing/unknown reason falls back to the
 * pre-existing `notOpen` string (now the unknown-reason fallback role).
 */
export function dealShapeErrorKind(
  status: number,
  code: string,
  details?: { reason?: unknown } | null,
): DealShapeErrorKind {
  if (status === 403 && code === "role_required") return "viewer";
  if (status === 403 && code === "role_forbidden") return "admin";
  if (status === 404) return "notFound";
  if (status === 413) return "tooLarge";
  if (status === 400 && code === "invalid_request") return "invalid";
  if (status === 409) {
    if (code === "deal_shape_not_open") {
      if (details?.reason === "stage_not_reached") return "notOpenStage";
      if (details?.reason === "track_not_brownfield") return "notOpenTrack";
      return "notOpen";
    }
    return code === "deal_shape_stale" ? "stale" : "conflict";
  }
  return "other";
}
