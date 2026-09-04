// 기회 → 프로젝트 승격 (ADR-0095). Promotion is a bookkeeping transition, not a
// gate — it creates the S8+ execution carrier and decides nothing; the
// fs/dd/entity_ic/group_ic gates stay human-authority (ADR-0053). Preconditions
// are FACT checks (greenfield S5 artifacts / brownfield S7 Short List), enforced
// inside promoteOpportunity; this route only maps the typed results to the
// envelope. Analyst+ role: a promotion is a funnel-state write, not a read.
import { getDb } from "../../../../../../../db/client.ts";
import { promoteOpportunity, PromotionError } from "../../../../../../../db/repositories/project.repository.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "프로젝트 승격은 analyst 역할 이상이어야 합니다.");
  if (ctx.role === "admin") {
    // ADR-0091 역할-화면 분리: admin은 시스템 운영자로 딜 콘텐츠에 접근하지
    // 않는다(visibleProject도 admin을 차단). admin이 승격하면 본인이 lead가
    // 되면서 모든 딜 라우트에서 404로 막히는 모순이 생기므로 진입 단계에서
    // 차단하고 analyst 계정으로 수행하도록 안내한다.
    return forbidden("role_forbidden", "admin 계정은 딜 콘텐츠에서 분리되어 있습니다(ADR-0091) — analyst 계정으로 승격하세요.");
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    needToKnowBasis?: string;
    origin?: string;
    /** ADR-0104 — override the auto-built charter name (charter is auto-built from S1~S7 artifacts). */
    project_name?: string;
  } | null;
  const basis = body?.needToKnowBasis?.trim();
  if (!basis) return badRequest("invalid_request", "needToKnowBasis는 필수입니다 — 승격자의 멤버십 근거가 기록되지 않으면 승격할 수 없습니다.");
  const origin = body?.origin;
  if (origin && !["internal", "external", "hybrid", "joint"].includes(origin)) {
    return badRequest("invalid_request", "origin은 internal | external | hybrid | joint 중 하나입니다 (ADR-0013).");
  }

  const db = getDb();
  const opp = db.query("SELECT id FROM opportunity WHERE id = ?").get(id) as { id: string } | undefined;
  if (!opp) return notFound();

  // ADR-0104 — build the charter from the S1~S7 artifacts before promoting.
  const { buildProjectCharter } = await import("../../../../../lib/project-charter.ts");
  const dbCharter = getDb();
  const route = dbCharter
    .query("SELECT track FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1")
    .get(id) as { track: "greenfield" | "brownfield" } | undefined;
  const built = buildProjectCharter(db, {
    opportunityId: id,
    track: route?.track ?? null,
    builtBy: ctx.userId,
    now: new Date().toISOString(),
  });
  const charterJson = JSON.stringify({ versions: [{ ...built.charter, purpose: built.charter.purpose }] });
  const projectName = body?.project_name?.trim() || built.name;

  try {
    const result = promoteOpportunity(id, {
      promotedBy: ctx.userId,
      needToKnowBasis: basis,
      origin: origin as "internal" | "external" | "hybrid" | "joint" | undefined,
      projectName,
      charterJson,
    });
    return ok(
      {
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
    return badRequest("promotion_failed", err instanceof Error ? err.message : "승격에 실패했습니다.");
  }
}
