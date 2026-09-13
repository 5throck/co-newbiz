// 기회별 평가 요인 — 자동 도출(POST), 수동 추가(PUT), 삭제(DELETE).
// 요인은 opportunity.factors_json(0051)에 영속되고 매력도 평가의 근거로 쓰인다.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { deriveAndSaveFactors, loadOpportunityWithFactors, readFactors, saveFactors } from "../../../../../lib/opportunity-factors.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const loaded = loadOpportunityWithFactors(id);
  if (!loaded) return notFound();
  return ok({ factors: loaded.factors, source: loaded.source }, 200);
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "요인 자동 도출은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT id, name, market_scope, value_chain_node, rationale FROM opportunity WHERE id = ?").get(id) as
    | { id: string; name: string; market_scope: string | null; value_chain_node: string | null; rationale: string | null }
    | null;
  if (!row) return notFound();
  const { factors, source, failed, error } = await deriveAndSaveFactors(db, row);
  appendAudit(db, { actor: auth.auth.userId, action: failed ? "opportunity.factors.derive_failed" : "opportunity.factors.derive", target: id, now: new Date().toISOString() });
  return ok({ factors, source, failed, error }, 200);
});

export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "요인 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { type?: string; text?: string } | null;
  const type = body?.type === "risk" ? "risk" : body?.type === "opportunity" ? "opportunity" : null;
  const text = body?.text?.trim();
  if (!type || !text) return badRequest("invalid_request", "type (opportunity|risk)와 text는 필수입니다.");
  const db = getDb();
  const row = db.query("SELECT factors_json, factors_source FROM opportunity WHERE id = ?").get(id) as
    | { factors_json: string | null; factors_source: string | null }
    | null;
  if (!row) return notFound();
  const factors = readFactors(row);
  factors[type] = [...factors[type], text].slice(0, 6);
  const source = row.factors_source ? `${row.factors_source}+manual` : "manual";
  saveFactors(db, id, factors, source);
  appendAudit(db, { actor: auth.auth.userId, action: "opportunity.factors.update", target: `${id}:add:${type}`, now: new Date().toISOString() });
  return ok({ factors, source }, 200);
});

export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "요인 삭제는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { type?: string; index?: number } | null;
  const type = body?.type === "risk" ? "risk" : body?.type === "opportunity" ? "opportunity" : null;
  const index = body?.index;
  if (!type || typeof index !== "number") return badRequest("invalid_request", "type과 index는 필수입니다.");
  const db = getDb();
  const row = db.query("SELECT factors_json, factors_source FROM opportunity WHERE id = ?").get(id) as
    | { factors_json: string | null; factors_source: string | null }
    | null;
  if (!row) return notFound();
  const factors = readFactors(row);
  factors[type] = factors[type].filter((_x: string, i: number) => i !== index);
  saveFactors(db, id, factors, row.factors_source ?? "manual");
  appendAudit(db, { actor: auth.auth.userId, action: "opportunity.factors.update", target: `${id}:remove:${type}:${index}`, now: new Date().toISOString() });
  return ok({ factors }, 200);
});
