// Generic allow-listed entity CRUD helper for deal-scope tables. Each spec
// declares editable columns with types and (optionally) required-ness; route
// handlers stay thin. Every write is audited. Hard delete + audit per the
// agreed deletion policy (confirm dialog in UI, audit trail in DB).
import { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ulid } from "../../../db/lib/ulid.ts";

export type ColType = "text" | "number" | "int" | "bool";

export interface EntitySpec {
  table: string;
  projectColumn?: string; // column carrying project_id (defaults to project_id)
  columns: Array<{ name: string; type: ColType; required?: boolean }>;
}

export function validateFields(
  spec: EntitySpec,
  body: Record<string, unknown>,
  opts: { partial?: boolean } = {},
): { cols: string[]; vals: unknown[]; errors: string[] } {
  const cols: string[] = [];
  const vals: unknown[] = [];
  const errors: string[] = [];
  for (const c of spec.columns) {
    const v = body[c.name];
    if (v === undefined || v === null || v === "") {
      // Partial updates (PUT) may omit fields; creation enforces required.
      if (c.required && !opts.partial) errors.push(`${c.name} is required.`);
      continue;
    }
    if (c.type === "number" || c.type === "int") {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        errors.push(`${c.name} must be a number.`);
        continue;
      }
      cols.push(c.name);
      vals.push(c.type === "int" ? Math.round(n) : n);
    } else if (c.type === "bool") {
      cols.push(c.name);
      vals.push(v === true || v === 1 || v === "1" || v === "true" ? 1 : 0);
    } else {
      cols.push(c.name);
      vals.push(String(v).trim());
    }
  }
  return { cols, vals, errors };
}

export interface CrudContext {
  actor: string;
  projectId: string;
  projectNo: string;
}

export function insertEntity(
  spec: EntitySpec,
  crud: CrudContext,
  body: Record<string, unknown>,
): { id: string } | { error: string } {
  const db = getDb();
  const { cols, vals, errors } = validateFields(spec, body);
  if (errors.length > 0) return { error: errors.join(" ") };
  const id = ulid();
  const now = new Date().toISOString();
  const projectCol = spec.projectColumn ?? "project_id";
  try {
    db.run(
      `INSERT INTO ${spec.table} (id, ${projectCol}, ${cols.join(", ")}, created_at)
       VALUES (?, ${cols.map(() => "?").join(", ")}, ?)`,
      [id, crud.projectId, ...vals, now],
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Insert failed." };
  }
  appendAudit(db, { actor: crud.actor, action: `${spec.table}_create`, target: `${crud.projectNo}:${id}`, now });
  return { id };
}

export function updateEntity(
  spec: EntitySpec,
  crud: CrudContext,
  rowId: string,
  body: Record<string, unknown>,
): { ok: true } | { error: string } {
  const db = getDb();
  const { cols, vals, errors } = validateFields(spec, body, { partial: true });
  if (errors.length > 0) return { error: errors.join(" ") };
  if (cols.length === 0) return { error: "No editable fields supplied." };
  const projectCol = spec.projectColumn ?? "project_id";
  const owned = db
    .query(`SELECT id FROM ${spec.table} WHERE id = ? AND ${projectCol} = ?`)
    .get(rowId, crud.projectId);
  if (!owned) return { error: "not_found" };
  const now = new Date().toISOString();
  db.run(
    `UPDATE ${spec.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    [...vals, rowId],
  );
  appendAudit(db, { actor: crud.actor, action: `${spec.table}_update`, target: `${crud.projectNo}:${rowId}`, now });
  return { ok: true };
}

export function deleteEntity(
  spec: EntitySpec,
  crud: CrudContext,
  rowId: string,
): { ok: true } | { error: string } {
  const db = getDb();
  const projectCol = spec.projectColumn ?? "project_id";
  const res = db.run(`DELETE FROM ${spec.table} WHERE id = ? AND ${projectCol} = ?`, [rowId, crud.projectId]);
  if (res.changes === 0) return { error: "not_found" };
  appendAudit(db, { actor: crud.actor, action: `${spec.table}_delete`, target: `${crud.projectNo}:${rowId}`, now: new Date().toISOString() });
  return { ok: true };
}
