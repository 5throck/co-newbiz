// opportunity-driver-links.ts — S2 driver-linkage pure logic (spec
// 2026-11-13-s2-driver-linkage D-B, DEC-20261113-05, ADR-0198 storage). An
// analyst attaches an ACCEPTED S1 calibration driver of the opportunity's own
// linked industry as a captured-provenance evidence record; human acceptance
// never upgrades the evidence class — the SERVER stamps confidence "C" and a
// client cannot raise it. This module owns the one contract both the route and
// the tests consume, mirroring entry-market.ts: strict validation on write
// (a deviation is a 400 with a reason, never a silent drop), tolerant parse on
// read (invalid stored JSON degrades to an empty link list, never a throw).
//
// Boundary statement (design D-E): nothing in this file writes a score, a
// verdict, the carrier's own lifecycle column or the factor store — the record
// is a payload document and the tests assert the source and the row equality
// before/after attach.

/** Sane maximum links per opportunity (design D-B, v1 — ample; no pagination). */
export const DRIVER_LINKS_MAX = 10;
const NOTE_MAX = 300;
const ROW_ID_MAX = 64;

/** The only evidence class a driver link can carry — LLM-estimated, human-
 *  accepted stays C (data confidence caps the RAG grade; boundary D-E.3). */
export const DRIVER_LINK_CONFIDENCE = "C" as const;

export type DriverLinkDirection = "upside" | "downside";

export interface DriverLinkRecord {
  driver_row_id: string;
  industry_id: string;
  industry_name: string;
  driver: string;
  direction: DriverLinkDirection;
  impact_pct: number;
  rationale: string;
  decided_by: string | null;
  decided_at: string | null;
  version_no: number | null;
  /** Server-stamped, always "C" — the caller-provided value is never used. */
  confidence: typeof DRIVER_LINK_CONFIDENCE;
  attached_by: string;
  attached_at: string;
  note?: string;
}

export interface DriverLinksDocument {
  links: DriverLinkRecord[];
  set_by: string;
  set_at: string;
}

export class DriverLinksValidationError extends Error {
  /** Machine-readable reason the route maps to the envelope code
   *  (already_linked -> 409, cap_exceeded -> 400, invalid_request -> 400). */
  code: "invalid_request" | "already_linked" | "cap_exceeded";
  constructor(code: DriverLinksValidationError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/** The analyst's attach request — strict key whitelist. A client-supplied
 *  confidence (or any other provenance field) is a 400: the server captures
 *  provenance from the live driver row, never from the request. */
export interface DriverLinkInput {
  driver_row_id: string;
  note?: string;
}

export function normalizeDriverLinkInput(body: unknown): DriverLinkInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DriverLinksValidationError("invalid_request", "The body must be an object with driver_row_id.");
  }
  const o = body as Record<string, unknown>;
  const ALLOWED = new Set(["driver_row_id", "note"]);
  for (const k of Object.keys(o)) {
    if (!ALLOWED.has(k)) {
      throw new DriverLinksValidationError(
        "invalid_request",
        `field "${k}" is not allowed — provenance is captured from the accepted driver row, never from the request.`,
      );
    }
  }
  const driver_row_id = o.driver_row_id;
  if (
    typeof driver_row_id !== "string" ||
    driver_row_id.trim().length === 0 ||
    driver_row_id.trim().length > ROW_ID_MAX
  ) {
    throw new DriverLinksValidationError("invalid_request", "driver_row_id must be a non-empty string.");
  }
  const input: DriverLinkInput = { driver_row_id: driver_row_id.trim() };
  if (o.note !== undefined) {
    if (typeof o.note !== "string" || o.note.trim().length === 0 || o.note.trim().length > NOTE_MAX) {
      throw new DriverLinksValidationError(
        "invalid_request",
        `note must be a string of at most ${NOTE_MAX} characters.`,
      );
    }
    input.note = o.note.trim();
  }
  return input;
}

/** The live driver-row fields the route resolves before calling this — a link
 *  is only ever built from an accepted row the server itself read. */
export interface DriverLinkSourceRow {
  id: string;
  industry_id: string;
  industry_name: string;
  driver: string;
  direction: DriverLinkDirection;
  impact_pct: number;
  rationale: string;
  decided_by: string | null;
  decided_at: string | null;
  version_no: number | null;
}

/** Build the captured-provenance link record. confidence is STAMPED here —
 *  the only value this function accepts is the constant; there is no input
 *  path for a client to raise it (boundary D-E.3). */
export function buildDriverLinkRecord(
  input: DriverLinkInput,
  driver: DriverLinkSourceRow,
  attachedBy: string,
  attachedAt: string,
): DriverLinkRecord {
  const record: DriverLinkRecord = {
    driver_row_id: driver.id,
    industry_id: driver.industry_id,
    industry_name: driver.industry_name,
    driver: driver.driver,
    direction: driver.direction,
    impact_pct: driver.impact_pct,
    rationale: driver.rationale,
    decided_by: driver.decided_by,
    decided_at: driver.decided_at,
    version_no: driver.version_no,
    confidence: DRIVER_LINK_CONFIDENCE,
    attached_by: attachedBy,
    attached_at: attachedAt,
  };
  if (input.note !== undefined) record.note = input.note;
  return record;
}

/** Cap + dedupe check before a record is appended. Throws with a machine
 *  code so the route maps duplicate -> 409 and cap -> 400. */
export function assertCanAddLink(doc: DriverLinksDocument | null, driverRowId: string): void {
  const links = doc?.links ?? [];
  if (links.length >= DRIVER_LINKS_MAX) {
    throw new DriverLinksValidationError(
      "cap_exceeded",
      `an opportunity carries at most ${DRIVER_LINKS_MAX} driver links.`,
    );
  }
  if (links.some((l) => l.driver_row_id === driverRowId)) {
    throw new DriverLinksValidationError("already_linked", "this driver row is already linked to the opportunity.");
  }
}

/** Append + persist envelope: returns the new document stamped with the
 *  acting analyst. Call assertCanAddLink first (the route owns the 409/400
 *  mapping); this function is the pure append for the happy path. */
export function addDriverLink(
  doc: DriverLinksDocument | null,
  record: DriverLinkRecord,
  setBy: string,
  setAt: string,
): DriverLinksDocument {
  return { links: [...(doc?.links ?? []), record], set_by: setBy, set_at: setAt };
}

/** Remove one link by row id. Null result = the link was not there (the
 *  route maps that to 404). */
export function removeDriverLink(doc: DriverLinksDocument | null, driverRowId: string): DriverLinksDocument | null {
  if (!doc) return null;
  const links = doc.links.filter((l) => l.driver_row_id !== driverRowId);
  if (links.length === doc.links.length) return null;
  return { links, set_by: doc.set_by, set_at: doc.set_at };
}

export function hasDriverLink(doc: DriverLinksDocument | null, driverRowId: string): boolean {
  return (doc?.links ?? []).some((l) => l.driver_row_id === driverRowId);
}

/** Tolerant parse of the stored payload (untrusted column): null on any
 *  deviation, never a throw — a hand-corrupted or shape-drifted document
 *  degrades to "no links" and the GET still renders. */
export function parseDriverLinksJson(raw: string | null | undefined): DriverLinksDocument | null {
  if (raw == null || raw === "") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.links)) return null;
  const links: DriverLinkRecord[] = [];
  for (const rawLink of o.links) {
    if (typeof rawLink !== "object" || rawLink === null) return null;
    const l = rawLink as Record<string, unknown>;
    const required: Array<keyof DriverLinkRecord> = [
      "driver_row_id",
      "industry_id",
      "industry_name",
      "driver",
      "direction",
      "impact_pct",
      "rationale",
      "confidence",
      "attached_by",
      "attached_at",
    ];
    for (const k of required) {
      if (l[k] === undefined) return null;
    }
    if (typeof l.driver_row_id !== "string" || typeof l.driver !== "string") return null;
    if (l.direction !== "upside" && l.direction !== "downside") return null;
    if (typeof l.impact_pct !== "number" || !Number.isFinite(l.impact_pct)) return null;
    links.push({
      driver_row_id: l.driver_row_id,
      industry_id: String(l.industry_id),
      industry_name: String(l.industry_name),
      driver: l.driver,
      direction: l.direction,
      impact_pct: l.impact_pct,
      rationale: String(l.rationale),
      decided_by: typeof l.decided_by === "string" ? l.decided_by : null,
      decided_at: typeof l.decided_at === "string" ? l.decided_at : null,
      version_no: typeof l.version_no === "number" ? l.version_no : null,
      confidence: DRIVER_LINK_CONFIDENCE,
      attached_by: String(l.attached_by),
      attached_at: String(l.attached_at),
      note: typeof l.note === "string" ? l.note : undefined,
    });
  }
  if (typeof o.set_by !== "string" || typeof o.set_at !== "string") return null;
  return { links, set_by: o.set_by, set_at: o.set_at };
}

/** Freshness of one stored link against the live calibration table — GET
 *  exposes `row_status[driver_row_id]` so a staleness banner can be added
 *  later without a schema change (design: deferred, GET only). */
export type DriverLinkRowStatus = "accepted" | "changed" | "missing";

export function computeRowStatus(liveStatus: string | null | undefined): DriverLinkRowStatus {
  if (liveStatus == null) return "missing";
  return liveStatus === "accepted" ? "accepted" : "changed";
}
