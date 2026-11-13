// GET/PUT/DELETE /api/opportunities/[id]/driver-links — the S1→S2 driver
// promotion path (spec 2026-11-13-s2-driver-linkage D-B, DEC-20261113-05,
// ADR-0198 storage). An analyst attaches an ACCEPTED S1 calibration driver of
// the opportunity's OWN linked industry as a captured-provenance evidence
// record on `opportunity.driver_links_json` (migration 0193, additive payload
// column). The server captures provenance from the live driver row — a client
// can never raise the server-stamped confidence "C". Storage is the
// entry-market-derivation pattern (strict on write with a reason, tolerant on
// read). Audit: opportunity.driver_links.update, once per action, targets
// "<id>:add:<driver_row_id>" / "<id>:remove:<driver_row_id>" (the factors
// route's …:remove:… convention). Boundary D-E: this write path never touches
// attractiveness_score, synergy_score, status, factors_json or any gate value,
// and nothing is auto-generated — the row-equality test pins that.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import {
  assertCanAddLink,
  addDriverLink,
  buildDriverLinkRecord,
  computeRowStatus,
  hasDriverLink,
  normalizeDriverLinkInput,
  parseDriverLinksJson,
  removeDriverLink,
  DriverLinksValidationError,
  type DriverLinksDocument,
} from "../../../../../lib/opportunity-driver-links.ts";
import { route } from "../../../../../lib/route.ts";

/** The live row for one stored driver_row_id (status only — the link record
 *  itself is the capture-at-attach truth). */
function liveDriverStatus(db: ReturnType<typeof getDb>, driverRowId: string): string | null {
  const row = db.query("SELECT status FROM industry_driver_calibration WHERE id = ?").get(driverRowId) as
    | { status: string }
    | undefined;
  return row?.status ?? null;
}

function rowStatusOf(db: ReturnType<typeof getDb>, doc: DriverLinksDocument | null) {
  const status: Record<string, string> = {};
  for (const l of doc?.links ?? []) {
    status[l.driver_row_id] = computeRowStatus(liveDriverStatus(db, l.driver_row_id));
  }
  return status;
}

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  {
    const denied = requireBusinessActor(auth.auth, "read");
    if (denied) return denied;
  }
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT driver_links_json FROM opportunity WHERE id = ?").get(id) as
    | { driver_links_json: string | null }
    | undefined;
  if (!row) return notFound();
  // Tolerant parse — an invalid stored payload degrades to no links, never a
  // throw (the house strict-on-write / tolerant-on-read pair).
  const doc = parseDriverLinksJson(row.driver_links_json);
  return ok({ links: doc?.links ?? [], row_status: rowStatusOf(db, doc) }, 200);
});

export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  {
    const denied = requireBusinessActor(ctx, "write", {
      viewerMessage: "Driver link attach requires the analyst role or higher.",
    });
    if (denied) return denied;
  }
  const { id } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, industry_id FROM opportunity WHERE id = ?").get(id) as
    | { id: string; industry_id: string | null }
    | undefined;
  if (!opp) return notFound();
  const body = (await request.json().catch(() => null)) as unknown;
  let input: ReturnType<typeof normalizeDriverLinkInput>;
  try {
    input = normalizeDriverLinkInput(body);
  } catch (err) {
    if (err instanceof DriverLinksValidationError) return badRequest(err.code, err.message);
    throw err;
  }
  // Server-side resolution: the row must exist, be ACCEPTED, and belong to the
  // opportunity's own linked industry (cross-industry reuse is a 400 — the
  // driver explains THAT industry's sizing gap).
  const driver = db
    .query(
      `SELECT c.id, c.industry_id, c.driver, c.direction, c.impact_pct, c.rationale,
              c.status, c.decided_by, c.decided_at, v.version_no
       FROM industry_driver_calibration c
       LEFT JOIN market_sizing_version v ON v.id = c.version_id
       WHERE c.id = ?`,
    )
    .get(input.driver_row_id) as
    | {
        id: string;
        industry_id: string;
        driver: string;
        direction: "upside" | "downside";
        impact_pct: number;
        rationale: string;
        status: string;
        decided_by: string | null;
        decided_at: string | null;
        version_no: number | null;
      }
    | undefined;
  if (!driver) return notFound("No such driver row exists.");
  if (driver.status !== "accepted") {
    return badRequest(
      "not_accepted",
      "Only an accepted calibration driver can be linked (proposed or dismissed rows are not attachable).",
    );
  }
  if (!opp.industry_id || driver.industry_id !== opp.industry_id) {
    return badRequest(
      "industry_mismatch",
      "The driver belongs to a different industry than the opportunity's linked industry.",
    );
  }
  const industry = db.query("SELECT name_ko FROM md_industry WHERE id = ?").get(driver.industry_id) as
    | { name_ko: string | null }
    | undefined;
  const doc = parseDriverLinksJson(
    (db.query("SELECT driver_links_json FROM opportunity WHERE id = ?").get(id) as { driver_links_json: string | null })
      .driver_links_json,
  );
  try {
    assertCanAddLink(doc, input.driver_row_id);
  } catch (err) {
    if (err instanceof DriverLinksValidationError) {
      if (err.code === "already_linked") return fail(409, "already_linked", err.message);
      return badRequest("cap_exceeded", err.message);
    }
    throw err;
  }
  const now = new Date().toISOString();
  const record = buildDriverLinkRecord(input, { ...driver, industry_name: industry?.name_ko ?? "" }, ctx.userId, now);
  const next = addDriverLink(doc, record, ctx.userId, now);
  db.transaction(() => {
    db.run("UPDATE opportunity SET driver_links_json = ? WHERE id = ?", [JSON.stringify(next), id]);
    appendAudit(db, {
      actor: ctx.userId,
      action: "opportunity.driver_links.update",
      target: `${id}:add:${input.driver_row_id}`,
      now,
    });
  })();
  return ok({ links: next.links, row_status: rowStatusOf(db, next) }, 200);
});

export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  {
    const denied = requireBusinessActor(ctx, "write", {
      viewerMessage: "Driver link removal requires the analyst role or higher.",
    });
    if (denied) return denied;
  }
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT driver_links_json FROM opportunity WHERE id = ?").get(id) as
    | { driver_links_json: string | null }
    | undefined;
  if (!row) return notFound();
  const body = (await request.json().catch(() => null)) as unknown;
  let input: ReturnType<typeof normalizeDriverLinkInput>;
  try {
    input = normalizeDriverLinkInput(body);
  } catch (err) {
    if (err instanceof DriverLinksValidationError) return badRequest(err.code, err.message);
    throw err;
  }
  const doc = parseDriverLinksJson(row.driver_links_json);
  if (!hasDriverLink(doc, input.driver_row_id)) {
    return notFound("No such driver link on this opportunity.");
  }
  const next = removeDriverLink(doc, input.driver_row_id);
  if (!next) return notFound("No such driver link on this opportunity.");
  // Content edit, not audit-log deletion — the audit_log row persists (ADR-0012).
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run("UPDATE opportunity SET driver_links_json = ? WHERE id = ?", [JSON.stringify(next), id]);
    appendAudit(db, {
      actor: ctx.userId,
      action: "opportunity.driver_links.update",
      target: `${id}:remove:${input.driver_row_id}`,
      now,
    });
  })();
  return ok({ links: next.links, row_status: rowStatusOf(db, next) }, 200);
});
