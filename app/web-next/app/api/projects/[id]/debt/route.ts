import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";
import { covenantHeadroom } from "../../../../../lib/covenant-headroom.ts";
import { debtCreateSchema } from "../../../../../lib/debt-input.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET/POST /api/projects/[id]/debt — debt instruments + covenant tests
// (financing/valuation). B6. 2026-10-21: GET adds the covenant headroom (S10
// financing-plan "커버넌트 여력", fin-03; also a heatmap input per ADR-0122 #2).
// 2026-10-28 (D1): the headroom is COMPUTED deterministically - these debt terms vs the
// adopted S8 case's downside cash flows (lib/covenant-dscr.ts) - and is
// insufficient_evidence (naming the missing input) when a term or the adoption is missing.
// `principal` is KRW millions, `rate` is PERCENT, `maturity` is "N년"/"Ny" or a date after
// the S8 adoption date, `amortization` is annuity | equal_principal | bullet.
export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const instruments = getDb()
    .query("SELECT * FROM debt_instrument WHERE project_id = ? ORDER BY rowid")
    .all(id);
  return ok({ instruments, headroom: covenantHeadroom(getDb(), id) }, 200, { instruments: instruments.length });
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "Registering debt instruments requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const raw = await request.json().catch(() => null);
  const parsed = debtCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return badRequest("invalid_debt_instrument", `${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  const body = parsed.data;
  const rateType = body.rate_type === "floating" ? "floating" : "fixed";
  const rid = ulid();
  getDb().run(
    `INSERT INTO debt_instrument (id, project_id, lender, principal, rate_type, rate, maturity, amortization, covenant_json, security, seniority)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [rid, id, body.lender?.trim() || null, body.principal, rateType, body.rate,
     body.maturity?.trim() || null, body.amortization?.trim() || null, body.covenant_json?.trim() || null,
     body.security?.trim() || null, body.seniority?.trim() || null],
  );
  appendAudit(getDb(), { actor: auth.auth.userId, action: "debt.create", target: `${id}:${rid}`, now: new Date().toISOString() });
  return ok({ id: rid }, 201);
});
