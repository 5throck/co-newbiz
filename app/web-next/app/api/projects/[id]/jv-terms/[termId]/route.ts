// JV 조건 수정/삭제 — project-scoped.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

const jsonOrNull = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === "string" && v.trim() === "")) return null;
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") {
    try { JSON.parse(v); return v; } catch { return JSON.stringify(v); }
  }
  return JSON.stringify(v);
};

export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string; termId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Updating JV terms requires the analyst role or higher.");
  const { id, termId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  const existing = db
    .query("SELECT id FROM jv_term WHERE id = ? AND project_id = ?")
    .get(termId, id) as { id: string } | undefined;
  if (!existing) return notFound();
  const body = (await request.json().catch(() => null)) as {
    equity_split?: string | null; governance?: unknown; veto_matters?: string | null;
    contribution?: unknown; exit_clause?: string | null; deadlock_mechanism?: string | null;
    non_compete_scope?: string | null;
  } | null;
  const now = new Date().toISOString();
  db.run(
    `UPDATE jv_term SET
       equity_split = COALESCE(?, equity_split),
       governance_json = COALESCE(?, governance_json),
       veto_matters = COALESCE(?, veto_matters),
       contribution_json = COALESCE(?, contribution_json),
       exit_clause = COALESCE(?, exit_clause),
       deadlock_mechanism = COALESCE(?, deadlock_mechanism),
       non_compete_scope = COALESCE(?, non_compete_scope)
     WHERE id = ?`,
    [
      body?.equity_split?.trim() || null,
      jsonOrNull(body?.governance) ?? null,
      body?.veto_matters?.trim() || null,
      jsonOrNull(body?.contribution) ?? null,
      body?.exit_clause?.trim() || null,
      body?.deadlock_mechanism?.trim() || null,
      body?.non_compete_scope?.trim() || null,
      termId,
    ],
  );
  appendAudit(db, { actor: ctx.userId, action: "jv_term.update", target: `${id}:${termId}`, now });
  return ok(db.query("SELECT * FROM jv_term WHERE id = ?").get(termId), 200);
});

export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string; termId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Deleting JV terms requires the analyst role or higher.");
  const { id, termId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  const existing = db
    .query("SELECT id FROM jv_term WHERE id = ? AND project_id = ?")
    .get(termId, id) as { id: string } | undefined;
  if (!existing) return notFound();
  const now = new Date().toISOString();
  db.run("DELETE FROM jv_term WHERE id = ?", [termId]);
  appendAudit(db, { actor: ctx.userId, action: "jv_term.delete", target: `${id}:${termId}`, now });
  return ok({ deleted: termId }, 200);
});
