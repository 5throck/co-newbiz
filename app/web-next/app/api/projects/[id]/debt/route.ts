import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";
import { covenantHeadroom } from "../../../../../lib/covenant-headroom.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET/POST /api/projects/[id]/debt — debt instruments + covenant tests
// (financing/valuation). B6. 2026-10-21: GET adds the covenant headroom of the
// latest simulation (S10 financing-plan "커버넌트 여력", fin-03; also a heatmap
// input per ADR-0122 #2) — insufficient_evidence when no simulation has run.
export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const instruments = getDb()
    .query("SELECT * FROM debt_instrument WHERE project_id = ? ORDER BY rowid")
    .all(id);
  // covenant_test rows are simulation-keyed (join via run) — the headroom view
  // reads the latest simulation; the raw rows stay in the liabilities views.
  return ok({ instruments, headroom: covenantHeadroom(getDb(), id) }, 200, { instruments: instruments.length });
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "차입 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    lender?: string | null; principal?: number; rate_type?: string; rate?: number;
    maturity?: string | null; covenant_json?: string | null; security?: string | null; seniority?: string | null;
  } | null;
  if (typeof body?.principal !== "number" || body.principal <= 0) return badRequest("principal_required", "principal은 양수여야 합니다.");
  const rateType = body.rate_type === "floating" ? "floating" : "fixed";
  const rid = ulid();
  getDb().run(
    `INSERT INTO debt_instrument (id, project_id, lender, principal, rate_type, rate, maturity, covenant_json, security, seniority)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [rid, id, body.lender?.trim() || null, body.principal, rateType, body.rate ?? 0,
     body.maturity?.trim() || null, body.covenant_json?.trim() || null,
     body.security?.trim() || null, body.seniority?.trim() || null],
  );
  appendAudit(getDb(), { actor: auth.auth.userId, action: "debt.create", target: `${id}:${rid}`, now: new Date().toISOString() });
  return ok({ id: rid }, 201);
});
