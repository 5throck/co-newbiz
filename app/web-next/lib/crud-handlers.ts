// Thin CRUD route builders — deal-scope entities share the same shape:
// GET (existing) + POST/PUT/DELETE backed by lib/entity-crud.ts allow-listed
// specs. Viewer is refused; analyst+ writes; every write audited.
import { badRequest, forbidden, notFound, ok } from "./envelope.ts";
import { insertEntity, updateEntity, deleteEntity, type EntitySpec } from "./entity-crud.ts";
import type { AuthContext } from "./auth.ts";

export interface CrudEnv {
  ctx: AuthContext;
  project: { id: string; project_no: string };
  spec: EntitySpec;
  rowId?: string;
  body: Record<string, unknown>;
}

export function handleCreate(env: CrudEnv) {
  if (env.ctx.role === "viewer") return forbidden("role_required", "Viewer role cannot create records.");
  const res = insertEntity(env.spec, { actor: env.ctx.userId, projectId: env.project.id, projectNo: env.project.project_no }, env.body);
  if ("error" in res) return badRequest("invalid_request", res.error);
  return ok(res, 201);
}

export function handleUpdate(env: CrudEnv) {
  if (env.ctx.role === "viewer") return forbidden("role_required", "Viewer role cannot update records.");
  if (!env.rowId) return badRequest("invalid_request", "rowId is required.");
  const res = updateEntity(env.spec, { actor: env.ctx.userId, projectId: env.project.id, projectNo: env.project.project_no }, env.rowId, env.body);
  if ("error" in res) {
    if (res.error === "not_found") return notFound();
    return badRequest("invalid_request", res.error);
  }
  return ok({ id: env.rowId });
}

export function handleDelete(env: CrudEnv) {
  if (env.ctx.role === "viewer") return forbidden("role_required", "Viewer role cannot delete records.");
  if (!env.rowId) return badRequest("invalid_request", "rowId is required.");
  const res = deleteEntity(env.spec, { actor: env.ctx.userId, projectId: env.project.id, projectNo: env.project.project_no }, env.rowId);
  if ("error" in res) {
    if (res.error === "not_found") return notFound();
    return badRequest("invalid_request", res.error);
  }
  return ok({ deleted: env.rowId });
}
