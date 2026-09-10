// 파트너 후보 + 실사 지적사항 (partner_candidate / partner_dd_finding) —
// deal detail surface under /api/projects/[id]/<resource> naming. Member-
// visible only via visibleProject (FR-SEC-01, admins excluded by role
// separation); GET viewer-ok, writes analyst+ with appendAudit.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

interface PartnerRow {
  id: string;
  name: string;
  partner_type: string;
  region_code: string | null;
  capability_score: number | null;
  capacity_score: number | null;
  financial_score: number | null;
  compliance_risk: string | null;
  customer_base_fit: number | null;
  dependency_risk: string | null;
  status: string;
  contacted_at: string | null;
  nda_signed: number;
  evidence_ref: string | null;
}

interface FindingRow {
  id: string;
  partner_id: string;
  workstream: string;
  severity: string;
  description: string;
  created_at: string;
}

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const partners = db
    .query(
      `SELECT id, name, partner_type, region_code, capability_score, capacity_score,
              financial_score, compliance_risk, customer_base_fit, dependency_risk,
              status, contacted_at, nda_signed, evidence_ref
       FROM partner_candidate WHERE project_id = ? ORDER BY name`,
    )
    .all(id) as PartnerRow[];
  const findings = db
    .query(
      `SELECT id, partner_id, workstream, severity, description, created_at
       FROM partner_dd_finding WHERE project_id = ? ORDER BY created_at DESC`,
    )
    .all(id) as FindingRow[];
  const byPartner = new Map<string, FindingRow[]>();
  for (const f of findings) {
    const list = byPartner.get(f.partner_id) ?? [];
    list.push(f);
    byPartner.set(f.partner_id, list);
  }
  return ok(
    {
      partners: partners.map((p) => ({ ...p, findings: byPartner.get(p.id) ?? [] })),
      finding_count: findings.length,
    },
    200,
    { count: partners.length },
  );
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "파트너 후보 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    name?: string; partner_type?: string; region_code?: string | null;
    capability_score?: number | null; capacity_score?: number | null; financial_score?: number | null;
    compliance_risk?: string | null; customer_base_fit?: number | null; dependency_risk?: string | null;
    status?: string; nda_signed?: boolean; evidence_ref?: string | null;
  } | null;
  const name = body?.name?.trim();
  const partnerType = body?.partner_type?.trim();
  if (!name || !partnerType) return badRequest("invalid_request", "name(후보명)과 partner_type(제휴 유형)은 필수입니다.");
  const status = body?.status?.trim() || "sourcing";
  const db = getDb();
  const now = new Date().toISOString();
  const row = {
    id: ulid(),
    project_id: id,
    name,
    partner_type: partnerType,
    region_code: body?.region_code?.trim() || null,
    capability_score: typeof body?.capability_score === "number" ? body.capability_score : null,
    capacity_score: typeof body?.capacity_score === "number" ? body.capacity_score : null,
    financial_score: typeof body?.financial_score === "number" ? body.financial_score : null,
    compliance_risk: body?.compliance_risk?.trim() || null,
    customer_base_fit: typeof body?.customer_base_fit === "number" ? body.customer_base_fit : null,
    dependency_risk: body?.dependency_risk?.trim() || null,
    status,
    contacted_at: status !== "sourcing" ? now : null,
    nda_signed: body?.nda_signed ? 1 : 0,
    evidence_ref: body?.evidence_ref?.trim() || null,
  };
  db.run(
    `INSERT INTO partner_candidate
       (id, project_id, name, partner_type, region_code, capability_score, capacity_score,
        financial_score, compliance_risk, customer_base_fit, dependency_risk, status,
        contacted_at, nda_signed, evidence_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.project_id, row.name, row.partner_type, row.region_code, row.capability_score,
      row.capacity_score, row.financial_score, row.compliance_risk, row.customer_base_fit,
      row.dependency_risk, row.status, row.contacted_at, row.nda_signed, row.evidence_ref],
  );
  appendAudit(db, { actor: ctx.userId, action: "partner_candidate.create", target: `${id}:${row.id}`, now });
  return ok(db.query("SELECT * FROM partner_candidate WHERE id = ?").get(row.id), 201);
});
