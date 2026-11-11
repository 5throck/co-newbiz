// 기회 → 프로젝트 승격 (ADR-0095). Promotion is a bookkeeping transition, not a
// gate — it creates the S8+ execution carrier and decides nothing; the
// fs/dd/entity_ic/group_ic gates stay human-authority (ADR-0053). Preconditions
// are FACT checks (greenfield S5 artifacts / brownfield S7 Short List), enforced
// inside promoteOpportunity; this route only maps the typed results to the
// envelope. Analyst+ role: a promotion is a funnel-state write, not a read.
import { getDb } from "../../../../../../../db/client.ts";
import { promoteOpportunity, PromotionError } from "../../../../../../../db/repositories/project.repository.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { ESTABLISHMENT_MODES, storeSuggestedMode, type EstablishmentMode } from "../../../../../lib/establishment.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { latestRouteDecision } from "../../../../../lib/process-flow.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer")
    return forbidden("role_required", "Promoting to a project requires the analyst role or higher.");
  if (ctx.role === "admin") {
    // ADR-0091 역할-화면 분리: admin은 시스템 운영자로 검토/안건 콘텐츠에 접근하지
    // 않는다(visibleProject도 admin을 차단). admin이 승격하면 본인이 lead가
    // 되면서 모든 검토/안건 라우트에서 404로 막히는 모순이 생기므로 진입 단계에서
    // 차단하고 analyst 계정으로 수행하도록 안내한다.
    return forbidden(
      "role_forbidden",
      "Admin accounts are segregated from review/case content (ADR-0091) — promote to an analyst account instead.",
    );
  }

  const { id } = await params;
  // project_member 역할은 리더/팀원 2값으로 축소되었다 (migration 0110,
  // 사용자 결정 2026-09-17 — 4역할 중 lead만 권한 분기가 존재했다).
  const ROLES = new Set(["lead", "member"]);
  const body = (await request.json().catch(() => null)) as {
    needToKnowBasis?: string;
    origin?: string;
    /** ADR-0167 — optional NON-BINDING hint; the mode only takes effect when a human chooses it at S10. */
    establishment_mode_suggested?: string;
    /** ADR-0104 — override the auto-built charter name (charter is auto-built from S1~S7 artifacts). */
    project_name?: string;
    members?: Array<{ userId?: string; projectRole?: string }>;
  } | null;
  const basis = body?.needToKnowBasis?.trim();
  if (!basis)
    return badRequest(
      "invalid_request",
      "needToKnowBasis is required — promotion is blocked until the promoter's membership basis is recorded.",
    );
  const origin = body?.origin;
  if (origin && !["internal", "external", "hybrid", "joint"].includes(origin)) {
    return badRequest("invalid_request", "origin must be one of: internal | external | hybrid | joint (ADR-0013).");
  }
  const hint = body?.establishment_mode_suggested;
  if (hint != null && !(ESTABLISHMENT_MODES as readonly string[]).includes(hint)) {
    return badRequest(
      "invalid_request",
      `establishment_mode_suggested must be one of: ${ESTABLISHMENT_MODES.join(" | ")} (ADR-0167).`,
    );
  }
  const members: Array<{ userId: string; projectRole: "lead" | "member" }> = [];
  for (const m of body?.members ?? []) {
    const userId = m?.userId?.trim();
    if (!userId) continue;
    if (!m?.projectRole || !ROLES.has(m.projectRole)) {
      return badRequest("invalid_request", "members[].projectRole must be one of: lead | member.");
    }
    members.push({ userId, projectRole: m.projectRole as "lead" | "member" });
  }

  const db = getDb();
  const opp = db.query("SELECT id FROM opportunity WHERE id = ?").get(id) as { id: string } | undefined;
  if (!opp) return notFound();

  // ADR-0104 — build the charter from the S1~S7 artifacts before promoting.
  const { buildProjectCharter } = await import("../../../../../lib/project-charter.ts");
  // Design 2026-11-11-route-decision-current-authority-design §9.2: the charter
  // track comes from the ADR-0135 authority row (is_current=1) via the shared
  // latestRouteDecision reader — an ADR-0124 draft with a fresher decided_at
  // must not stamp its track into the charter (or the promotion-time
  // md_project.track display snapshot) over the flagged final.
  const route = latestRouteDecision(id);
  const built = buildProjectCharter(db, {
    opportunityId: id,
    track: route?.track ?? null,
    builtBy: ctx.userId,
    now: new Date().toISOString(),
  });
  const charterJson = JSON.stringify({ versions: [{ ...built.charter, purpose: built.charter.purpose }] });
  const projectName = body?.project_name?.trim() || built.name;
  if (hint) {
    // A hint only makes sense for a Green Field project; business_unit additionally needs origin internal (D2).
    const effectiveOrigin = origin ?? (route?.track === "greenfield" ? "internal" : undefined);
    if (
      route?.track !== "greenfield" ||
      (hint === "business_unit" && effectiveOrigin !== "internal") ||
      (hint === "new_entity" && effectiveOrigin !== "internal" && effectiveOrigin !== "joint")
    ) {
      return badRequest(
        "mode_not_allowed",
        "Establishment-mode proposals apply only to greenfield projects; new business-unit pursuit requires origin=internal (ADR-0167).",
      );
    }
  }

  try {
    const result = promoteOpportunity(id, {
      promotedBy: ctx.userId,
      needToKnowBasis: basis,
      origin: origin as "internal" | "external" | "hybrid" | "joint" | undefined,
      projectName,
      charterJson,
      members,
    });
    if (hint) storeSuggestedMode(db, result.project.id, hint as EstablishmentMode);
    return ok(
      {
        establishment_mode_suggested: hint ?? null,
        project_id: result.project.id,
        project_no: result.project.project_no,
        track: result.project.track,
        source_opportunity_id: result.opportunityId,
        promoted_at: result.promotedAt,
      },
      200,
    );
  } catch (err) {
    if (err instanceof PromotionError) {
      if (err.code === "not_found") return notFound();
      return badRequest(err.code, err.message);
    }
    return badRequest("promotion_failed", err instanceof Error ? err.message : "Promotion failed.");
  }
}
