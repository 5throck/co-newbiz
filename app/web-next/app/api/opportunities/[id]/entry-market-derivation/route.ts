// GET/PUT /api/opportunities/[id]/entry-market-derivation — ADR-0179
// amendment slice B (2026-10-17, design §12.2): the S2 entry-market
// derivation surface, a ratio-factor chain over the LINKED S1 series. GET
// returns the stored chain plus the always-COMPUTED value (S1 anchor x
// product of factors at the pinned version's year-1 baseline); tolerant on
// read-model failures, but an opportunity with no pinned S1 link is a 409
// not_linked with a hint — a derivation chain cannot exist without its
// upstream. PUT is HUMAN-ONLY (boundary #2; in HUMAN_ONLY_ROUTES + the
// MCP-coverage exclusions): a person (analyst+) replaces the WHOLE chain
// atomically or clears it ({steps: null}); strict validation — bad factor,
// missing source, broken base chain, too many steps or any absolute-amount
// key is 400 invalid_request with a reason, never silently dropped, and a
// factor is never fabricated. Audit: opportunity_entry_market.write,
// target "<id>#entry-market@<via>".
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import {
  compareReachedScope,
  computeEntryMarketChain,
  confidenceLoweringCount,
  ENTRY_MARKET_CONFIDENCE_NOTE,
  ENTRY_MARKET_MAX_STEPS,
  ENTRY_MARKET_SCOPE_NOTE,
  normalizeEntryMarketDerivationInput,
  parseEntryMarketDerivationJson,
  readS1AnchorYear1,
  reachedScopeOf,
  REGION_DEFINITION_CAVEAT,
  type EntryMarketDerivation,
} from "../../../../../lib/entry-market.ts";
import { parseTargetScopeJson } from "../../../../../lib/target-scope.ts";
import { readSizingLink } from "../sizing-link/route.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT entry_market_derivation_json AS der, target_scope_json AS scope_json FROM opportunity WHERE id = ?").get(id) as
    | { der: string | null; scope_json: string | null }
    | undefined;
  if (!row) return notFound();
  const linked = readSizingLink(db, id);
  if (!linked?.link) {
    return fail(409, "not_linked", "S1 시장규모 분석이 연결되지 않았습니다 — 도출 사슬은 연결된 S1 버전의 앵커에서만 계산됩니다 (sizing-link 연결 후 시도).");
  }
  let derivation: EntryMarketDerivation | null = null;
  let derError: string | null = null;
  try {
    derivation = parseEntryMarketDerivationJson(row.der);
  } catch (err) {
    derError = err instanceof Error ? err.message : "invalid derivation";
  }
  let computed = null;
  if (derivation && linked.reference?.anchor_value_krw_m != null) {
    computed = computeEntryMarketChain(linked.reference.anchor_value_krw_m, derivation.steps);
  }
  let scopeFlag = null;
  if (derivation) {
    let targetScope = null;
    try {
      targetScope = parseTargetScopeJson(row.scope_json);
    } catch {
      targetScope = null;
    }
    scopeFlag = { ...compareReachedScope(reachedScopeOf(derivation.steps), targetScope), note: ENTRY_MARKET_SCOPE_NOTE };
  }
  return ok(
    {
      link: linked.link,
      reference: linked.reference,
      link_provenance: linked.link_provenance,
      newer_version_available: linked.newer_version_available,
      derivation,
      derivation_error: derError,
      computed,
      scope_flag: scopeFlag,
      confidence: { lowering_count: derivation ? confidenceLoweringCount(derivation.steps) : 0, note: ENTRY_MARKET_CONFIDENCE_NOTE },
      region_caveat: REGION_DEFINITION_CAVEAT,
      max_steps: ENTRY_MARKET_MAX_STEPS,
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
    "입장 시장 도출 사슬은 사람만 입력할 수 있습니다 (boundary #2) — 에이전트는 읽기만 가능합니다.",
  );
  if (denied) return denied;
  { const d = requireBusinessActor(ctx, "write", { viewerMessage: "entry market derivation 입력은 analyst 역할 이상이어야 합니다." }); if (d) return d; }
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT id FROM opportunity WHERE id = ?").get(id);
  if (!row) return notFound();
  const linked = readSizingLink(db, id);
  if (!linked?.link) {
    return fail(409, "not_linked", "S1 시장규모 분석을 먼저 연결해야 도출 사슬을 입력할 수 있습니다.");
  }
  const body = (await request.json().catch(() => null)) as unknown;
  if (typeof body !== "object" || body === null) return badRequest("invalid_request", "도출 사슬 변경 요청이 아닙니다.");
  const b = body as Record<string, unknown>;
  if (b.steps === null) {
    // Clear: the whole chain is removed atomically; the legacy bare anchor
    // path resumes byte-identically.
    const at = new Date().toISOString();
    db.transaction(() => {
      db.run("UPDATE opportunity SET entry_market_derivation_json = NULL WHERE id = ?", [id]);
      appendAudit(db, { actor: ctx.userId, action: "opportunity_entry_market.write", target: `${id}#entry-market@${callPathOf(ctx)}`, now: at });
    })();
    return ok({ derivation: null, computed: null }, 200);
  }
  let steps;
  try {
    ({ steps } = normalizeEntryMarketDerivationInput(b));
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : "invalid derivation");
  }
  // The chain is only meaningful against a computable anchor: a linked but
  // anchor-less version would make the "computed, never stored" contract
   // vacuous, so the person is sent back with a reason instead of storing a
  // chain that computes to nothing.
  if (linked.reference?.anchor_value_krw_m == null) {
    return badRequest("invalid_request", "연결된 S1 버전에 앵커 값이 없어 도출 계산이 불가합니다 — 앵커가 있는 버전을 연결해 주세요.");
  }
  const record = { steps, set_by: ctx.userId, set_at: new Date().toISOString() };
  db.transaction(() => {
    db.run("UPDATE opportunity SET entry_market_derivation_json = ? WHERE id = ?", [JSON.stringify(record), id]);
    appendAudit(db, { actor: ctx.userId, action: "opportunity_entry_market.write", target: `${id}#entry-market@${callPathOf(ctx)}`, now: record.set_at });
  })();
  const computed = computeEntryMarketChain(linked.reference.anchor_value_krw_m, steps);
  return ok({ derivation: record, computed }, 200);
}
