// GET/PUT /api/opportunities/[id]/target-scope — the structured target scope
// of the promoting opportunity (ADR-0179 slice 1; ADR-0181 slice 1/2). PUT is
// HUMAN-ONLY (boundary #2): a person (analyst+) records the regions /
// segments / unit_basis the deal addresses; bearer / MCP-principal / agent
// callers get 403 human_only (registered in HUMAN_ONLY_ROUTES). GET is open
// to anyone who can see the opportunity. Validation is strict: an invalid
// shape is a 400 invalid_request, never silently dropped. Audit:
// opportunity_target_scope.write, target "<id>#target-scope@<via>".
//
// ADR-0181: storage is the 0151 FK tables via the entry-market repository
// (the frozen target_scope_json column is the read-only fallback). The region
// vocabulary widens to the LINKED S1 MATRIX's region codes (the person picks
// the entry region from S1 — S1 itself is frozen, read-only) UNION the fixed
// enum; `worldwide` stays mutually exclusive; an unknown code is still a 400.
// GET additively carries `matrix_regions`/`matrix_segments` (read-only S1
// data) so the editor renders the S1 pick list, and `linked_sizing` (slice A).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, callPathOf, humanOnlyDenied, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { TARGET_SCOPE_REGIONS, UNIT_BASIS_PATTERN, type TargetScope } from "../../../../../lib/target-scope.ts";
import { readSizingRegions, readSizingSegments } from "../../../../../lib/sizing-payload.ts";
import { readTargetScope, writeTargetScope } from "../../../../../../../db/repositories/entry-market.repository.ts";
import { readSizingLink } from "../sizing-link/route.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT id FROM opportunity WHERE id = ?").get(id) as { id: string } | undefined;
  if (!row) return notFound();
  const linked = readSizingLink(db, id);
  let matrixRegions: ReturnType<typeof readSizingRegions> = [];
  let matrixSegments: ReturnType<typeof readSizingSegments> = [];
  if (linked?.link) {
    const v = db.query("SELECT payload FROM market_sizing_version WHERE id = ?").get(linked.link.version_id) as
      | { payload: string | null }
      | undefined;
    matrixRegions = readSizingRegions(v?.payload ?? null);
    matrixSegments = readSizingSegments(v?.payload ?? null);
  }
  return ok({ scope: readTargetScope(db, id), linked_sizing: linked?.reference ?? null, matrix_regions: matrixRegions, matrix_segments: matrixSegments }, 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = humanOnlyDenied(ctx, "구조화된 대상 범위는 사람만 입력할 수 있습니다 (boundary #2) — 에이전트는 읽기만 가능합니다.");
  if (denied) return denied;
  { const d = requireBusinessActor(ctx, "write", { viewerMessage: "Target-scope inputs require the analyst role or higher." }); if (d) return d; }
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT id FROM opportunity WHERE id = ?").get(id);
  if (!row) return notFound();
  const body = (await request.json().catch(() => null)) as unknown;
  if (typeof body !== "object" || body === null) return badRequest("invalid_request", "Not a target-scope change request.");
  const o = body as Record<string, unknown>;
  // Region vocabulary (ADR-0181 slice 2): fixed enum ∪ the linked matrix's
  // region codes — the person picks the entry region from S1. worldwide stays
  // exclusive; unknown codes are a 400, never silently dropped.
  let matrixCodes: string[] = [];
  const linked = readSizingLink(db, id);
  if (linked?.link) {
    const v = db.query("SELECT payload FROM market_sizing_version WHERE id = ?").get(linked.link.version_id) as
      | { payload: string | null }
      | undefined;
    matrixCodes = readSizingRegions(v?.payload ?? null).map((r) => r.code);
  }
  const allowed = new Set<string>([...TARGET_SCOPE_REGIONS, ...matrixCodes]);
  if (!Array.isArray(o.regions) || o.regions.length === 0 || !o.regions.every((r) => typeof r === "string" && allowed.has(r))) {
    return badRequest("invalid_request", `regions must include at least one of the linked S1 regions or: ${TARGET_SCOPE_REGIONS.join(", ")}.`);
  }
  const regions = o.regions as string[];
  if (regions.includes("worldwide") && regions.length > 1) {
    return badRequest("invalid_request", "worldwide cannot be combined with other regions.");
  }
  if (!Array.isArray(o.segments)) return badRequest("invalid_request", "segments must be an array of strings.");
  const segments = [...new Set((o.segments as unknown[]).map((s) => String(s).trim()).filter((s) => s.length > 0))];
  for (const s of segments) {
    if (s.length > 100) return badRequest("invalid_request", "Each segment must be at most 100 characters.");
  }
  const unitBasis = o.unit_basis;
  if (unitBasis !== undefined && unitBasis !== null && (typeof unitBasis !== "string" || !UNIT_BASIS_PATTERN.test(unitBasis))) {
    return badRequest("invalid_request", "unit_basis must be krw_m_year / units_year / <currency>_[mb]_year (e.g. usd_m_year, usd_b_year).");
  }
  const scope = { regions, segments, unit_basis: (typeof unitBasis === "string" ? unitBasis : null) as TargetScope["unit_basis"] };
  const at = new Date().toISOString();
  writeTargetScope(db, id, scope, ctx.userId, at);
  appendAudit(db, { actor: ctx.userId, action: "opportunity_target_scope.write", target: `${id}#target-scope@${callPathOf(ctx)}`, now: at });
  return ok({ scope: { ...scope, set_by: ctx.userId, set_at: at } }, 200);
}
