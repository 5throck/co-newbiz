// Business-case CRUD for one project — the S8 surface (ADR-0098 §3).
// Manual CRUD coexists with automatic generation (POST
// .../business-case/generate); both write paths land in the same
// business_case_model / business_case_line / valuation_simulation tables, so
// the S8 completion check cannot tell the difference and does not need to.
// Visibility is deny-by-default: getProjectIfVisible via visibleProject —
// non-members get 404 (existence itself is protected, FR-SEC-01); admins are
// excluded by role separation. Writes are analyst+.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { listBusinessCases } from "../../../../../lib/business-case.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";

const KINDS = new Set(["greenfield_cost", "revenue", "valuation", "investment_return"]);
const CATEGORIES = new Set(["labor", "opex", "capex", "revenue", "gov_rnd"]);

interface LineInput {
  category?: string;
  name?: string;
  annual_amount_krw_m?: number;
  start_year?: number;
  growth_rate?: number;
  note?: string;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const { cases, recommendedScenario, adoption } = listBusinessCases(id);
  return ok(
    { cases, recommended_scenario: recommendedScenario, adoption },
    200,
    { count: cases.length },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Business Case 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    kind?: string;
    horizon_years?: number;
    lines?: LineInput[];
  } | null;
  if (!body?.name?.trim()) return badRequest("invalid_request", "name은 필수입니다.");
  const name = body.name.trim();
  const kind = body.kind ?? "valuation";
  if (!KINDS.has(kind)) return badRequest("invalid_request", `kind는 ${[...KINDS].join(" | ")} 중 하나입니다.`);
  const db = getDb();
  const lineError = validateLines(body.lines ?? []);
  if (lineError) return badRequest("invalid_request", lineError);
  const modelId = ulid();
  const now = new Date().toISOString();
  // All-or-nothing: model + lines land in ONE transaction (mirror of
  // reviewDdCustomItem) so a failure leaves no orphan/partial rows.
  db.transaction(() => {
    db.run(
      "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      [modelId, id, kind, name, body.horizon_years && body.horizon_years > 0 ? Math.floor(body.horizon_years) : 5, ctx.userId, now],
    );
    insertLines(db, modelId, body.lines ?? [], ctx.userId, now);
  })();
  return ok({ id: modelId }, 201);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Business Case 수정은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    model_id?: string;
    name?: string;
    horizon_years?: number;
    // Full line replacement — the manual editor sends the whole set.
    lines?: LineInput[];
  } | null;
  if (!body?.model_id) return badRequest("invalid_request", "model_id는 필수입니다.");
  const db = getDb();
  const model = db.query("SELECT id FROM business_case_model WHERE id = ? AND project_id = ?").get(body.model_id, id) as
    | { id: string }
    | undefined;
  if (!model) return notFound();
  const now = new Date().toISOString();
  if (typeof body.name === "string" && body.name.trim()) {
    db.run("UPDATE business_case_model SET name = ? WHERE id = ?", [body.name.trim(), body.model_id]);
  }
  if (typeof body.horizon_years === "number" && body.horizon_years > 0) {
    db.run("UPDATE business_case_model SET horizon_years = ? WHERE id = ?", [Math.floor(body.horizon_years), body.model_id]);
  }
  if (Array.isArray(body.lines)) {
    const lineError = validateLines(body.lines);
    if (lineError) return badRequest("invalid_request", lineError);
    const modelId = body.model_id;
    const lines = body.lines;
    // Full-line replacement is all-or-nothing: delete + reinsert inside ONE
    // transaction, so a failed insert never leaves the case without lines.
    db.transaction(() => {
      db.run("DELETE FROM business_case_line WHERE model_id = ?", [modelId]);
      insertLines(db, modelId, lines, ctx.userId, now);
    })();
  }
  return ok({ id: body.model_id }, 200);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Business Case 삭제는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const modelId = new URL(request.url).searchParams.get("model_id");
  if (!modelId) return badRequest("invalid_request", "model_id 쿼리 파라미터가 필요합니다.");
  const db = getDb();
  const model = db.query("SELECT id FROM business_case_model WHERE id = ? AND project_id = ?").get(modelId, id) as
    | { id: string }
    | undefined;
  if (!model) return notFound();
  // valuation_simulation has no ON DELETE CASCADE — remove its rows first.
  db.run("DELETE FROM valuation_simulation WHERE model_id = ?", [modelId]);
  db.run("DELETE FROM business_case_line WHERE model_id = ?", [modelId]);
  db.run("DELETE FROM business_case_model WHERE id = ?", [modelId]);
  appendAudit(db, { actor: auth.auth.userId, action: "business_case.delete", target: `${id}:${modelId}`, now: new Date().toISOString() });
  return ok({ id: modelId }, 200);
}

/** Validate every line BEFORE any insert (the transaction must not fail midway). Returns an error message for the 400 envelope, or null. */
function validateLines(lines: LineInput[]): string | null {
  for (const line of lines) {
    if (!line.category || !CATEGORIES.has(line.category)) {
      return `line category는 ${[...CATEGORIES].join(" | ")} 중 하나입니다.`;
    }
    if (typeof line.annual_amount_krw_m !== "number" || Number.isNaN(line.annual_amount_krw_m)) {
      return "line annual_amount_krw_m은 숫자여야 합니다.";
    }
  }
  return null;
}

/** Insert pre-validated lines. Call inside a transaction. */
function insertLines(db: ReturnType<typeof getDb>, modelId: string, lines: LineInput[], userId: string, now: string): void {
  for (const line of lines) {
    db.run(
      `INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, note, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        ulid(),
        modelId,
        line.category,
        line.name?.trim() || line.category,
        line.annual_amount_krw_m,
        typeof line.start_year === "number" && line.start_year >= 1 ? Math.floor(line.start_year) : 1,
        typeof line.growth_rate === "number" ? line.growth_rate : 0,
        line.note?.trim() || null,
        userId,
        now,
      ],
    );
  }
}
