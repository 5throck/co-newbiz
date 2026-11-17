// ADR-0194 item A (PR-1): view logic of the deal-shape evaluation panel (design 2026-11-07-kill-data-sources §3.6; relocated from S4 to S7 by ADR-0195).
// Pure data mapping, no React: the panel renders these results, tests pin them.
// A verdict is a human-recorded fact. Nothing here derives, suggests or pre-fills a verdict.

export interface DealShapeRow {
  id: string;
  opportunity_id: string;
  shape: string;
  intent: string;
  viable: boolean;
  rationale: string;
  evidence_ref: string | null;
  evaluated_by: string;
  evaluated_at: string;
  superseded_by: string | null;
}

export interface DealShapeData {
  opportunity_id: string;
  live: DealShapeRow[];
  history: DealShapeRow[];
  unevaluated_shapes: string[];
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

export type ViableStatus = { kind: "unassessed" } | { kind: "triggered" } | { kind: "viable"; count: number };

/** null stays "unassessed" - it must never be read as zero. A recorded 0 triggers #9 (shown as conditional). */
export function viableStatus(count: number | null): ViableStatus {
  if (count === null) return { kind: "unassessed" };
  if (count < 1) return { kind: "triggered" };
  return { kind: "viable", count };
}

export type ShapeVerdictRow =
  | { shape: string; state: "unevaluated" }
  | { shape: string; state: "viable" | "not_viable"; row: DealShapeRow };

/** One row per vocabulary shape, in vocabulary order: the live verdict, or "unevaluated". */
export function shapeVerdictRows(data: Pick<DealShapeData, "live" | "vocabulary">): ShapeVerdictRow[] {
  const liveByShape = new Map(data.live.map((r) => [r.shape, r]));
  const shapes = [...data.vocabulary.shapes];
  for (const r of data.live) if (!shapes.includes(r.shape)) shapes.push(r.shape);
  return shapes.map((shape): ShapeVerdictRow => {
    const row = liveByShape.get(shape);
    return row ? { shape, state: row.viable ? "viable" : "not_viable", row } : { shape, state: "unevaluated" };
  });
}

export interface DealShapeForm {
  shape: string;
  intent: string;
  /** null until a person picks: there is no default verdict. */
  viable: boolean | null;
  rationale: string;
  evidenceRef: string;
}

export const EMPTY_DEAL_SHAPE_FORM: DealShapeForm = {
  shape: "",
  intent: "",
  viable: null,
  rationale: "",
  evidenceRef: "",
};

/** Loads a previously RECORDED row (the person's own earlier entry) into the form for correction. */
export function formFromRow(row: DealShapeRow): DealShapeForm {
  return {
    shape: row.shape,
    intent: row.intent,
    viable: row.viable,
    rationale: row.rationale,
    evidenceRef: row.evidence_ref ?? "",
  };
}

export type FormProblem = "shape" | "intent" | "viable" | "rationale" | "rationaleTooLong" | "evidenceTooLong";

/** Early client check; the server stays authoritative. Order = field order on screen. */
export function validateDealShapeForm(f: DealShapeForm): FormProblem | null {
  if (!f.shape) return "shape";
  if (!f.intent) return "intent";
  if (f.viable === null) return "viable";
  const rationale = f.rationale.trim();
  if (!rationale) return "rationale";
  if (rationale.length > RATIONALE_MAX) return "rationaleTooLong";
  if (f.evidenceRef.trim().length > EVIDENCE_MAX) return "evidenceTooLong";
  return null;
}

/** Request body: no evaluator field (the server takes the session user), optional evidence omitted when blank. */
export function buildDealShapeBody(f: DealShapeForm): {
  shape: string;
  intent: string;
  viable: boolean;
  rationale: string;
  evidence_ref?: string;
} {
  const evidence = f.evidenceRef.trim();
  return {
    shape: f.shape,
    intent: f.intent,
    viable: f.viable === true,
    rationale: f.rationale.trim(),
    ...(evidence ? { evidence_ref: evidence } : {}),
  };
}

/**
 * TEMPORARY ADAPTER (ADR-0201 PR 1; replaced by the overall-first form in the UI PR): the per-shape form is mapped onto the
 * replace-the-set contract. Viable = the other live viable shapes plus this one; not viable = this shape leaves the set, and an
 * empty remainder becomes one overall "no shape is viable" verdict. Carries the live_token the panel last loaded.
 */
export function buildDealShapeSetBody(f: DealShapeForm, data: Pick<DealShapeData, "live" | "live_token">) {
  const evidence = f.evidenceRef.trim();
  const kept = data.live
    .filter((r) => r.viable && r.shape !== f.shape)
    .map((r) => ({
      shape: r.shape,
      rationale: r.rationale,
      ...(r.evidence_ref ? { evidence_ref: r.evidence_ref } : {}),
    }));
  const live_token = data.live_token ?? "";
  if (f.viable === true)
    return {
      viable: true,
      intent: f.intent,
      shapes: [
        ...kept,
        { shape: f.shape, rationale: f.rationale.trim(), ...(evidence ? { evidence_ref: evidence } : {}) },
      ],
      live_token,
    };
  if (kept.length === 0)
    return {
      viable: false,
      rationale: f.rationale.trim(),
      ...(evidence ? { evidence_ref: evidence } : {}),
      live_token,
    };
  return { viable: true, intent: f.intent, shapes: kept, live_token };
}

export type DealShapeErrorKind = "viewer" | "admin" | "notFound" | "invalid" | "notOpen" | "conflict" | "other";

/**
 * Maps the route's error envelope to a message kind (400 invalid_request, 403 role_required / role_forbidden, 404,
 * 409). The route returns 409 when the opportunity is before S7 or not brownfield: `deal_shape_not_open` gets its own
 * message; any other 409 is shown with the server's own message ("conflict"), so a renamed code still reads correctly.
 */
export function dealShapeErrorKind(status: number, code: string): DealShapeErrorKind {
  if (status === 403 && code === "role_required") return "viewer";
  if (status === 403 && code === "role_forbidden") return "admin";
  if (status === 404) return "notFound";
  if (status === 400 && code === "invalid_request") return "invalid";
  if (status === 409) return code === "deal_shape_not_open" ? "notOpen" : "conflict";
  return "other";
}
