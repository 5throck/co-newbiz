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
import { readSizingRegionTrends, readSizingRegions, readSizingSegments } from "../../../../../lib/sizing-payload.ts";
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
  const scopeUnitBasis = scope?.unit_basis ?? null;
  const legacyAnchor = { market_size_krw_m: row.market_size_krw_m ?? null, growth_rate: row.growth_rate ?? null };
  const record = readEntryMarketRecord(db, id);
  const fx = readFx(db, id);
  const additive = { scope_set: scopeSet, scope_unit_basis: scopeUnitBasis, legacy_anchor: legacyAnchor };
  const linked = readSizingLink(db, id);
  if (!linked?.link) {
    const res = fail(409, "not_linked", "S1 시장규모 분석이 연결되지 않았습니다 — 도출 사슬은 연결된 S1 버전의 앵커에서만 계산됩니다 (sizing-link 연결 후 시도).");
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
    const anchorScope = linked.reference?.scope ?? null;
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
  { const d = requireBusinessActor(ctx, "write", { viewerMessage: "진입시장 산정 입력은 analyst 역할 이상이어야 합니다." }); if (d) return d; }
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT id FROM opportunity WHERE id = ?").get(id);
  if (!row) return notFound();
  const linked = readSizingLink(db, id);
  if (!linked?.link) {
    return fail(409, "not_linked", "S1 시장규모 분석을 먼저 연결해야 진입시장 입력을 할 수 있습니다.");
  }
  const body = (await request.json().catch(() => null)) as unknown;
  if (typeof body !== "object" || body === null) return badRequest("invalid_request", "진입시장 변경 요청이 아닙니다.");
  const b = body as Record<string, unknown>;
  const now = new Date().toISOString();
  const touchesChain = b.steps !== undefined;
  const touchesMeta = b.market_brief !== undefined || b.currency !== undefined || b.growth_rate !== undefined;
  const touchesFx = b.fx !== undefined;
  if (!touchesChain && !touchesMeta && !touchesFx) {
    return badRequest("invalid_request", "변경할 항목이 없습니다 (steps / market_brief / currency / growth_rate / fx 중 하나 이상).");
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
        return badRequest("invalid_request", "연결된 S1 버전에 앵커 값이 없어 도출 계산이 불가합니다 — 앵커가 있는 버전을 연결해 주세요.");
      }
    }
  }

  // ── Meta (brief / currency / growth) validation ──
  const meta: { market_brief?: string | null; currency?: string | null; growth_rate?: number | null } = {};
  if (b.market_brief !== undefined) {
    if (b.market_brief === null) meta.market_brief = null;
    else if (typeof b.market_brief === "string" && b.market_brief.trim().length > 0 && b.market_brief.length <= 2000) {
      meta.market_brief = b.market_brief.trim();
    } else return badRequest("invalid_request", "market_brief는 2000자 이하의 문자열이어야 합니다.");
  }
  if (b.currency !== undefined) {
    if (b.currency === null) meta.currency = null;
    else if (typeof b.currency === "string" && /^[A-Z]{3}$/.test(b.currency)) meta.currency = b.currency;
    else return badRequest("invalid_request", "currency는 3자 대문자 ISO 통화 코드여야 합니다 (예: USD, EUR; KRW·units는 null).");
  }
  if (b.growth_rate !== undefined) {
    if (b.growth_rate === null) meta.growth_rate = null;
    else if (typeof b.growth_rate === "number" && Number.isFinite(b.growth_rate) && b.growth_rate > 0 && b.growth_rate <= 1) {
      meta.growth_rate = b.growth_rate; // RATIO storage — a percent-scale input (>1) is a 400 (unit-trap guard)
    } else return badRequest("invalid_request", "growth_rate는 0~1 범위의 비율이어야 합니다 (예: 0.13 = 13%). 퍼센트 값은 100으로 나누어 입력하세요.");
  }

  // ── FX rows validation (per-currency, ADR-0181 slice 3) ──
  let fxRows: Array<{ currency: string; rate: number; volatility: number | null }> | null = null;
  if (touchesFx) {
    if (!Array.isArray(b.fx)) return badRequest("invalid_request", "fx는 {currency, rate, volatility?} 배열이어야 합니다.");
    const seen = new Set<string>();
    fxRows = [];
    for (const raw of b.fx) {
      if (typeof raw !== "object" || raw === null) return badRequest("invalid_request", "fx 항목은 객체여야 합니다.");
      const r = raw as Record<string, unknown>;
      if (typeof r.currency !== "string" || !/^[A-Z]{3}$/.test(r.currency)) {
        return badRequest("invalid_request", "fx.currency는 3자 대문자 ISO 통화 코드여야 합니다.");
      }
      if (r.currency === "KRW") return badRequest("invalid_request", "KRW는 원화 기준 통화라 환율 행을 갖지 않습니다.");
      if (typeof r.rate !== "number" || !Number.isFinite(r.rate) || r.rate <= 0 || r.rate > FX_RATE_MAX) {
        return badRequest("invalid_request", `fx.rate는 0 초과 ${FX_RATE_MAX} 이하의 숫자여야 합니다 (원/통화).`);
      }
      if (r.volatility !== undefined && r.volatility !== null && (typeof r.volatility !== "number" || !Number.isFinite(r.volatility) || r.volatility < 0 || r.volatility > 0.5)) {
        return badRequest("invalid_request", "fx.volatility는 0~0.5 범위의 비율이어야 합니다 (예: 0.10 = ±10%).");
      }
      if (seen.has(r.currency)) return badRequest("invalid_request", `fx에 ${r.currency} 행이 중복됩니다.`);
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
