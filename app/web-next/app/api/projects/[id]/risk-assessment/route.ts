// GET/PUT /api/projects/[id]/risk-assessment — the person's likelihood/impact
// assessment overrides for the S9 risk heatmap (2026-10-19 decider question:
// the auto-derived heatmap had hardcoded likelihood). GET returns the override
// map; PUT records one override (analyst+ person-only, audited — boundary #2).
// The auto-derived values remain the default display when no override exists.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import {
  mergeRiskAssessment,
  parseRiskAssessment,
  serializeRiskAssessment,
  validateRiskAssessmentInput,
  RiskAssessmentValidationError,
} from "../../../../../lib/risk-assessment.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (!visibleProject(auth.auth, (await params).id)) return notFound();
  const db = getDb();
  const row = db
    .query("SELECT risk_heatmap_assessment_json AS j FROM md_project WHERE id = ?")
    .get((await params).id) as { j: string | null } | undefined;
  return ok({ overrides: parseRiskAssessment(row?.j) }, 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "리스크 판정 기록은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { key?: unknown; likelihood?: unknown; impact?: unknown } | null;
  try {
    const v = validateRiskAssessmentInput({ key: body?.key, likelihood: body?.likelihood, impact: body?.impact });
    const db = getDb();
    const row = db
      .query("SELECT risk_heatmap_assessment_json AS j FROM md_project WHERE id = ?")
      .get(id) as { j: string | null } | undefined;
    const map = parseRiskAssessment(row?.j);
    const now = new Date().toISOString();
    const merged = mergeRiskAssessment(map, v.key, v.likelihood, v.impact, auth.auth.userId, now);
    db.run("UPDATE md_project SET risk_heatmap_assessment_json = ? WHERE id = ?", [serializeRiskAssessment(merged), id]);
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "risk_assessment.recorded",
      target: `${id}:${v.key}:${v.likelihood}-${v.impact}`,
      now,
    });
    return ok({ key: v.key, likelihood: v.likelihood, impact: v.impact }, 201);
  } catch (err) {
    if (err instanceof RiskAssessmentValidationError) return badRequest("invalid_request", err.message);
    console.error("risk-assessment PUT failed", err);
    return fail(500, "internal_error", "리스크 판정 저장에 실패했습니다.");
  }
}
