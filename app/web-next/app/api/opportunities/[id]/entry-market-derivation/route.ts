// GET/PUT /api/opportunities/[id]/entry-market-derivation — the S2 entry-market
// surface (ADR-0179 amendment slice B storage; ADR-0181 normalized). GET
// returns the stored chain plus the always-COMPUTED value (S1 anchor × product
// of factors at the pinned version's year-1 baseline) and, additively since
// ADR-0181: market_brief / currency / growth_rate / fx (per-currency reference
// rates) / region_trends (read-only S1 matrix trends for the selected regions).
// The scope verdict is RECORD-LEVEL since ADR-0181 (supersedes §B.5): the
// person's selection vs the anchor's declared scope via compareAnchorScope.
// Tolerant on read failures; an opportunity with no pinned S1 link is a 409
// not_linked (additive fields still ride the body so the card renders).
//
// PUT is HUMAN-ONLY (boundary #2; in HUMAN_ONLY_ROUTES + the MCP-coverage
// exclusions): a person (analyst+) replaces the WHOLE chain atomically
// ({steps:[…]}), clears it ({steps:null}), and — ADR-0181 — sets the
// aggregate inputs on the SAME audited PUT: market_brief, currency,
// growth_rate (RATIO 0..1; percent-scale input is a 400 — the review board's
// unit-trap fix) and fx (per-currency {currency, rate, volatility} rows).
// Storage is the 0151 FK tables via the entry-market repository (JSON columns
// are frozen read-only fallbacks). Strict validation everywhere; a factor or
// a rate is never fabricated. Audit: opportunity_entry_market.write,
// target "<id>#entry-market@<via>".
import { NextResponse } from "next/server";
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import {
  computeEntryMarketChain,
  confidenceLoweringCount,
  ENTRY_MARKET_CONFIDENCE_NOTE,
  ENTRY_MARKET_MAX_STEPS,
  ENTRY_MARKET_SCOPE_NOTE,
  normalizeEntryMarketDerivationInput,
  REGION_DEFINITION_CAVEAT,
  type EntryMarketDerivation,
} from "../../../../../lib/entry-market.ts";
import { compareAnchorScope, ANCHOR_SCOPE_CONFIDENCE_NOTE } from "../../../../../lib/anchor-scope.ts";
import { readSizingEffectiveScope, readSizingRegionTrends, readSizingRegions, readSizingSegments } from "../../../../../lib/sizing-payload.ts";
import { extractSizingVersionScope } from "../../../../../lib/anchor-scope.ts";
import {
  readChain,
  readEntryMarketRecord,
  readFx,
  readTargetScope,
  writeChain,
  clearChain,
  writeEntryMarketMeta,
  writeFx,
} from "../../../../../../../db/repositories/entry-market.repository.ts";
import { readSizingLink } from "../sizing-link/route.ts";

/** The linked version's EFFECTIVE declared unit (explicit declaration, then
 *  the pipeline $B convention) — ADR-0181 amendment. */
function linkedDeclaredUnit(db: ReturnType<typeof getDb>, opportunityId: string): string | null {
  const link = readSizingLink(db, opportunityId);
  if (!link?.link) return null;
  const v = db.query("SELECT payload FROM market_sizing_version WHERE id = ?").get(link.link.version_id) as
    | { payload: string | null }
    | undefined;
  const eff = readSizingEffectiveScope(v?.payload ?? null);
  return eff?.unit_basis ?? null;
}

const FX_RATE_MAX = 1_000_000;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const row = db
    .query("SELECT market_size_krw_m, growth_rate FROM opportunity WHERE id = ?")
    .get(id) as { market_size_krw_m: number | null; growth_rate: number | null } | undefined;
  if (!row) return notFound();
  // Additive card fields (2026-10-17 redesign §5.1 + ADR-0181): scope_set /
  // scope_unit_basis / legacy_anchor / record inputs ride even the not-linked
  // 409 body so an unlinked opportunity still renders its strip. Tolerant.
  const scope = readTargetScope(db, id);
  const scopeSet = scope != null;
  // ADR-0181 follow-up: the unit resolves from the LINKED S1 declaration
  // (analysis unit_basis / $B convention) — the saved scope no longer
  // carries it.
  const scopeUnitBasis = linkedDeclaredUnit(db, id);
  const legacyAnchor = { market_size_krw_m: row.market_size_krw_m ?? null, growth_rate: row.growth_rate ?? null };
  const record = readEntryMarketRecord(db, id);
  const fx = readFx(db, id);
  const additive = { scope_set: scopeSet, scope_unit_basis: scopeUnitBasis, legacy_anchor: legacyAnchor };
  const linked = readSizingLink(db, id);
  if (!linked?.link) {
    const res = fail(409, "not_linked", "No linked S1 market-sizing analysis — the derivation chain is computed only from the linked S1 version anchors (link sizing-link first).");
    try {
      const body = (await res.json()) as { data: unknown; error: unknown };
      body.data = { ...additive, market_brief: record?.market_brief ?? null, currency: record?.currency ?? null, growth_rate: record?.growth_rate ?? null, fx };
      return NextResponse.json(body, { status: 409 });
    } catch {
      return res;
    }
  }
  let derivation: EntryMarketDerivation | null = null;
  try {
    derivation = readChain(db, id);
  } catch (err) {
    derivation = null;
  }
  let computed = null;
  if (derivation && linked.reference?.anchor_value_krw_m != null) {
    computed = computeEntryMarketChain(linked.reference.anchor_value_krw_m, derivation.steps);
  }
  // ADR-0181 (supersedes §B.5): RECORD-LEVEL scope verdict — the person's
  // selection vs the anchor's DECLARED scope. Regions decide; advisory only.
  let scopeFlag: { status: string; reason: string; note: string } | null = null;
  if (derivation && scope) {
    // ADR-0181 amendment: the anchor side uses the EFFECTIVE coverage
    // (explicit declaration, then the pipeline $B-payload convention) so a
    // legacy undeclared version still produces a meaningful verdict.
    const v = db.query("SELECT payload FROM market_sizing_version WHERE id = ?").get(linked.link.version_id) as
      | { payload: string | null }
      | undefined;
    const anchorScope = extractSizingVersionScope(v?.payload ?? null) ?? readSizingEffectiveScope(v?.payload ?? null);
    const verdict = compareAnchorScope(anchorScope, scope);
    scopeFlag = {
      status: verdict.status,
      reason: verdict.reason,
      note: `${ENTRY_MARKET_SCOPE_NOTE} ${ANCHOR_SCOPE_CONFIDENCE_NOTE}`,
    };
  }
  // Read-only S1 trends for the selected regions (S1 frozen — payload read).
  const payloadRow = db.query("SELECT payload FROM market_sizing_version WHERE id = ?").get(linked.link.version_id) as
    | { payload: string | null }
    | undefined;
  const regionTrends = scope ? readSizingRegionTrends(payloadRow?.payload ?? null, scope.regions) : [];
  return ok(
    {
      link: linked.link,
      reference: linked.reference,
      link_provenance: linked.link_provenance,
      newer_version_available: linked.newer_version_available,
      derivation,
      computed,
      scope_flag: scopeFlag,
      confidence: { lowering_count: derivation ? confidenceLoweringCount(derivation.steps) : 0, note: ENTRY_MARKET_CONFIDENCE_NOTE },
      region_caveat: REGION_DEFINITION_CAVEAT,
      max_steps: ENTRY_MARKET_MAX_STEPS,
      scope_set: additive.scope_set,
      scope_unit_basis: additive.scope_unit_basis,
      legacy_anchor: additive.legacy_anchor,
      // ADR-0181 additive record inputs:
      market_brief: record?.market_brief ?? null,
      currency: record?.currency ?? null,
      growth_rate: record?.growth_rate ?? null,
      fx,
      matrix_regions: readSizingRegions(payloadRow?.payload ?? null),
      matrix_segments: readSizingSegments(payloadRow?.payload ?? null),
      region_trends: regionTrends,
    },
    200,
  );
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = humanOnlyDenied(
    ctx,
    "진입시장 산정 입력은 사람만 할 수 있습니다 (boundary #2) — 에이전트는 읽기만 가능합니다.",
  );
  if (denied) return denied;
  { const d = requireBusinessActor(ctx, "write", { viewerMessage: "Entry-market sizing inputs require the analyst role or higher." }); if (d) return d; }
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT id FROM opportunity WHERE id = ?").get(id);
  if (!row) return notFound();
  const linked = readSizingLink(db, id);
  if (!linked?.link) {
    return fail(409, "not_linked", "Link an S1 market-sizing analysis before entering entry-market inputs.");
  }
  const body = (await request.json().catch(() => null)) as unknown;
  if (typeof body !== "object" || body === null) return badRequest("invalid_request", "Not an entry-market change request.");
  const b = body as Record<string, unknown>;
  const now = new Date().toISOString();
  const touchesChain = b.steps !== undefined;
  const touchesMeta = b.market_brief !== undefined || b.currency !== undefined || b.growth_rate !== undefined;
  const touchesFx = b.fx !== undefined;
  if (!touchesChain && !touchesMeta && !touchesFx) {
    return badRequest("invalid_request", "Nothing to change (send at least one of: steps / market_brief / currency / growth_rate / fx).");
  }

  // ── Chain replace/clear (unchanged strict rules, ADR-0179 §B) ──
  let steps: ReturnType<typeof normalizeEntryMarketDerivationInput>["steps"] | null = null;
  if (touchesChain) {
    if (b.steps === null) {
      steps = null;
    } else {
      try {
        ({ steps } = normalizeEntryMarketDerivationInput(b));
      } catch (err) {
        return badRequest("invalid_request", err instanceof Error ? err.message : "invalid derivation");
      }
      if (linked.reference?.anchor_value_krw_m == null) {
        return badRequest("invalid_request", "The linked S1 version has no anchor values, so derivation cannot run — link a version with anchors.");
      }
    }
  }

  // ── Meta (brief / currency / growth) validation ──
  const meta: { market_brief?: string | null; currency?: string | null; growth_rate?: number | null } = {};
  if (b.market_brief !== undefined) {
    if (b.market_brief === null) meta.market_brief = null;
    else if (typeof b.market_brief === "string" && b.market_brief.trim().length > 0 && b.market_brief.length <= 2000) {
      meta.market_brief = b.market_brief.trim();
    } else return badRequest("invalid_request", "market_brief must be a string of at most 2000 characters.");
  }
  if (b.currency !== undefined) {
    if (b.currency === null) meta.currency = null;
    else if (typeof b.currency === "string" && /^[A-Z]{3}$/.test(b.currency)) meta.currency = b.currency;
    else return badRequest("invalid_request", "currency must be a 3-letter uppercase ISO currency code (e.g. USD, EUR; null for KRW/units).");
  }
  if (b.growth_rate !== undefined) {
    if (b.growth_rate === null) meta.growth_rate = null;
    else if (typeof b.growth_rate === "number" && Number.isFinite(b.growth_rate) && b.growth_rate > 0 && b.growth_rate <= 1) {
      meta.growth_rate = b.growth_rate; // RATIO storage — a percent-scale input (>1) is a 400 (unit-trap guard)
    } else return badRequest("invalid_request", "growth_rate must be a ratio in [0, 1] (e.g. 0.13 = 13%). Divide percent values by 100.");
  }

  // ── FX rows validation (per-currency, ADR-0181 slice 3) ──
  let fxRows: Array<{ currency: string; rate: number; volatility: number | null }> | null = null;
  if (touchesFx) {
    if (!Array.isArray(b.fx)) return badRequest("invalid_request", "fx must be an array of {currency, rate, volatility?}.");
    const seen = new Set<string>();
    fxRows = [];
    for (const raw of b.fx) {
      if (typeof raw !== "object" || raw === null) return badRequest("invalid_request", "Each fx item must be an object.");
      const r = raw as Record<string, unknown>;
      if (typeof r.currency !== "string" || !/^[A-Z]{3}$/.test(r.currency)) {
        return badRequest("invalid_request", "fx.currency must be a 3-letter uppercase ISO currency code.");
      }
      if (r.currency === "KRW") return badRequest("invalid_request", "KRW is the base currency and has no FX row.");
      if (typeof r.rate !== "number" || !Number.isFinite(r.rate) || r.rate <= 0 || r.rate > FX_RATE_MAX) {
        return badRequest("invalid_request", `fx.rate must be a number greater than 0 and at most ${FX_RATE_MAX} (KRW per currency).`);
      }
      if (r.volatility !== undefined && r.volatility !== null && (typeof r.volatility !== "number" || !Number.isFinite(r.volatility) || r.volatility < 0 || r.volatility > 0.5)) {
        return badRequest("invalid_request", "fx.volatility must be a ratio in [0, 0.5] (e.g. 0.10 = ±10%).");
      }
      if (seen.has(r.currency)) return badRequest("invalid_request", `fx has a duplicate ${r.currency} row.`);
      seen.add(r.currency);
      fxRows.push({ currency: r.currency, rate: r.rate, volatility: typeof r.volatility === "number" ? r.volatility : null });
    }
  }

  // ── Apply (single audited transaction per concern; all human-only) ──
  const at = now;
  db.transaction(() => {
    if (steps === null) clearChain(db, id);
    else if (steps) writeChain(db, id, steps, ctx.userId, at);
    if (Object.keys(meta).length > 0) writeEntryMarketMeta(db, id, meta, ctx.userId, at);
    if (fxRows) writeFx(db, id, fxRows, ctx.userId, at);
    appendAudit(db, { actor: ctx.userId, action: "opportunity_entry_market.write", target: `${id}#entry-market@${callPathOf(ctx)}`, now: at });
  })();

  const derivation = touchesChain ? readChain(db, id) : undefined;
  const computed = derivation && linked.reference?.anchor_value_krw_m != null
    ? computeEntryMarketChain(linked.reference.anchor_value_krw_m, derivation.steps)
    : null;
  return ok({ derivation: derivation ?? null, computed }, 200);
}
