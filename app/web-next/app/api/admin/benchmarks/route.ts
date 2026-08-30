// Admin CRUD for the benchmark case library.
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../lib/envelope.ts";

const DEAL_TYPES = new Set(["greenfield", "brownfield", "license-in", "jv", "partnership"]);

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const ctx = auth.auth;
  const body = (await request.json().catch(() => null)) as {
    title?: string; industry?: string; region?: string; deal_type?: string;
    deal_year?: number; deal_size_krw_m?: number; summary_ko?: string;
    key_metrics_json?: string; source_ref?: string;
  } | null;
  if (!body?.title?.trim() || !body?.deal_type || !DEAL_TYPES.has(body.deal_type) || !body?.summary_ko?.trim()) {
    return badRequest("invalid_request", "title, deal_type (greenfield|brownfield|license-in|jv|partnership), summary_ko are required.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  db.run(
    `INSERT INTO benchmark_case (id, title, industry, region, deal_type, deal_year, deal_size_krw_m,
                                 summary_ko, key_metrics_json, source_ref, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, body.title.trim(), body.industry?.trim() ?? null, body.region?.trim() ?? null, body.deal_type,
      body.deal_year ?? null, body.deal_size_krw_m ?? null, body.summary_ko.trim(),
      body.key_metrics_json ?? null, body.source_ref?.trim() ?? null, ctx.userId, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "benchmark_case_create", target: id, now });
  return ok({ id, created_at: now }, 201);
}

export async function PUT(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const ctx = auth.auth;
  const body = (await request.json().catch(() => null)) as {
    id?: string; title?: string; industry?: string; region?: string; deal_type?: string;
    deal_year?: number; deal_size_krw_m?: number; summary_ko?: string;
    key_metrics_json?: string; source_ref?: string;
  } | null;
  if (!body?.id) return badRequest("invalid_request", "id is required.");
  const db = getDb();
  const existing = db.query("SELECT id FROM benchmark_case WHERE id = ?").get(body.id);
  if (!existing) return notFound();
  db.run(
    `UPDATE benchmark_case SET title = ?, industry = ?, region = ?, deal_type = ?, deal_year = ?,
             deal_size_krw_m = ?, summary_ko = ?, key_metrics_json = ?, source_ref = ?
       WHERE id = ?`,
    [body.title?.trim() ?? null, body.industry?.trim() ?? null, body.region?.trim() ?? null,
      body.deal_type ?? null, body.deal_year ?? null, body.deal_size_krw_m ?? null,
      body.summary_ko?.trim() ?? null, body.key_metrics_json ?? null, body.source_ref?.trim() ?? null, body.id],
  );
  appendAudit(db, { actor: ctx.userId, action: "benchmark_case_update", target: body.id, now: new Date().toISOString() });
  return ok({ id: body.id });
}

export async function DELETE(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const ctx = auth.auth;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return badRequest("invalid_request", "id query param is required.");
  const db = getDb();
  const res = db.run("DELETE FROM benchmark_case WHERE id = ?", [id]);
  if (res.changes === 0) return notFound();
  appendAudit(db, { actor: ctx.userId, action: "benchmark_case_delete", target: id, now: new Date().toISOString() });
  return ok({ deleted: id });
}
