// Master-data management (admin). GET without ?table lists the manageable
// tables; GET with ?table= lists codes; POST adds a code row; PUT updates
// one. The md_* code tables are heterogeneous, so both table names and column
// names are strictly allow-listed below — nothing from the request reaches
// SQL unvalidated. (Supersedes the read-only staging queue listing, which
// moved to app/api/admin/master-data/staging/route.ts.)
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";

// table → editable columns (id is always required and immutable after create)
const MASTER_TABLES: Record<string, { columns: { name: string; type: "text" | "number" }[] }> = {
  md_industry: {
    columns: [
      { name: "ksic_code", type: "text" },
      { name: "naics_code", type: "text" },
      { name: "name_ko", type: "text" },
      { name: "name_en", type: "text" },
    ],
  },
  md_currency: { columns: [{ name: "iso_code", type: "text" }] },
  md_country: { columns: [{ name: "iso_code", type: "text" }] },
  md_source: {
    columns: [
      { name: "code", type: "text" },
      { name: "reliability_grade", type: "text" },
    ],
  },
  md_unit: {
    columns: [
      { name: "code", type: "text" },
      { name: "dimension", type: "text" },
      { name: "si_coefficient", type: "number" },
    ],
  },
  md_company: {
    columns: [
      { name: "dart_corp_code", type: "text" },
      { name: "biz_reg_no", type: "text" },
      { name: "name_ko", type: "text" },
      { name: "name_en", type: "text" },
    ],
  },
};

function tableOf(name: string | null | undefined) {
  if (!name || !MASTER_TABLES[name]) return null;
  return { name, spec: MASTER_TABLES[name] };
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const url = new URL(request.url);
  const tableName = url.searchParams.get("table");
  if (!tableName) {
    return ok({ tables: Object.keys(MASTER_TABLES) }, 200, { count: Object.keys(MASTER_TABLES).length });
  }
  const table = tableOf(tableName);
  if (!table) return badRequest("unknown_table", `table must be one of ${Object.keys(MASTER_TABLES).join(", ")}.`);
  const cols = ["id", ...table.spec.columns.map((c) => c.name), "created_at"];
  const rows = getDb()
    .query(`SELECT ${cols.join(", ")} FROM ${table.name} ORDER BY id LIMIT 200`)
    .all();
  return ok({ table: table.name, columns: cols, rows }, 200, { count: (rows as unknown[]).length });
}

function validateFields(
  spec: { columns: { name: string; type: "text" | "number" }[] },
  fields: Record<string, unknown> | undefined,
): { cols: string[]; vals: unknown[] } {
  const cols: string[] = [];
  const vals: unknown[] = [];
  if (fields) {
    for (const c of spec.columns) {
      if (fields[c.name] === undefined || fields[c.name] === null || fields[c.name] === "") continue;
      const v = c.type === "number" ? Number(fields[c.name]) : String(fields[c.name]).trim();
      if (Number.isNaN(v as number) && c.type === "number") continue;
      cols.push(c.name);
      vals.push(v);
    }
  }
  return { cols, vals };
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const ctx = auth.auth;
  const body = (await request.json().catch(() => null)) as {
    table?: string; id?: string; fields?: Record<string, unknown>;
  } | null;
  const table = tableOf(body?.table);
  if (!table) return badRequest("invalid_request", `table must be one of ${Object.keys(MASTER_TABLES).join(", ")}.`);
  if (!body?.id?.trim()) return badRequest("invalid_request", "id is required.");
  const { cols, vals } = validateFields(table.spec, body.fields);
  const db = getDb();
  const now = new Date().toISOString();
  try {
    db.run(
      `INSERT INTO ${table.name} (id, ${cols.join(", ")}, created_at) VALUES (?, ${cols.map(() => "?").join(", ")}, ?)`,
      [body.id.trim(), ...vals, now],
    );
  } catch (err) {
    return badRequest("insert_failed", err instanceof Error ? err.message : "Insert failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "master_data_add", target: `${table.name}:${body.id}`, now });
  return ok({ table: table.name, id: body.id.trim() }, 201);
}

export async function PUT(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const ctx = auth.auth;
  const body = (await request.json().catch(() => null)) as {
    table?: string; id?: string; fields?: Record<string, unknown>;
  } | null;
  const table = tableOf(body?.table);
  if (!table) return badRequest("invalid_request", `table must be one of ${Object.keys(MASTER_TABLES).join(", ")}.`);
  if (!body?.id?.trim()) return badRequest("invalid_request", "id is required.");
  const { cols, vals } = validateFields(table.spec, body.fields);
  if (cols.length === 0) return badRequest("invalid_request", "No editable fields supplied.");
  const db = getDb();
  const res = db.run(
    `UPDATE ${table.name} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    [...vals, body.id.trim()],
  );
  if (res.changes === 0) return badRequest("not_found", "No such master-data row.");
  appendAudit(db, { actor: ctx.userId, action: "master_data_update", target: `${table.name}:${body.id}`, now: new Date().toISOString() });
  return ok({ table: table.name, id: body.id.trim() });
}
