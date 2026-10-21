import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET/POST /api/projects/[id]/incentives — bidirectional incentive management
// (prospective sourcing with region-profile join; clawback exposure). B3.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const rows = getDb()
    .query("SELECT * FROM incentive WHERE project_id = ? ORDER BY rowid DESC")
    .all(id);
  return ok({ incentives: rows }, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "인센티브 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    direction?: string; type?: string; grantor?: string | null; program_name?: string;
    npv_value?: number | null; clawback_rule?: string | null; region_code?: string | null; evidence_ref?: string | null;
  } | null;
  if (!body?.program_name?.trim()) return badRequest("program_required", "program_name은 필수입니다.");
  const direction = body.direction === "granted" ? "granted" : "prospective";
  const now = new Date().toISOString();
  const rid = ulid();
  // 2026-10-21: evidence_ref — the eligibility evidence that lets the incentive
  // enter the S10 financing plan's sources side (deal-structuring step 7).
  getDb().run(
    `INSERT INTO incentive (id, project_id, direction, type, grantor, program_name, npv_value, clawback_rule, evidence_ref, status)
     VALUES (?,?,?,?,?,?,?,?,?, 'prospective')`,
    [rid, id, direction, body.type?.trim() || "region_subsidy", body.grantor?.trim() || null,
     body.program_name.trim(), body.npv_value ?? null, body.clawback_rule?.trim() || null, body.evidence_ref?.trim() || null],
  );
  appendAudit(getDb(), { actor: auth.auth.userId, action: "incentive.create", target: `${id}:${rid}`, now });
  return ok({ id: rid }, 201);
}
