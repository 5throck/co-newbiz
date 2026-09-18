// Target costing (design 2026-09-18-s8-business-case-evaluation REQ-W2) —
// GET: the latest recorded analysis for the project. POST: compute + persist
// one target_cost_gap analysis (analyst+; see skill target-costing-analysis).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { GAP_THRESHOLD, TargetCostValidationError, latestTargetCostAnalysis, recordTargetCostAnalysis } from "../../../../../lib/target-costing.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const latest = latestTargetCostAnalysis(getDb(), id);
  return ok(
    {
      latest,
      threshold: GAP_THRESHOLD,
      wiring: latest?.thresholdExceeded ? { downside_opex_uplift_applies: true } : { downside_opex_uplift_applies: false },
    },
    200,
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "타겟코스팅 분석은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    market_price?: unknown;
    target_margin?: unknown;
    estimated_unit_cost?: unknown;
    levers?: unknown;
    source?: unknown;
    rationale?: unknown;
    price_evidence?: unknown;
  } | null;

  const num = (key: string): number => {
    const v = (body as Record<string, unknown> | null)?.[key];
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (typeof n !== "number") throw new TargetCostValidationError(`${key}는 숫자여야 합니다.`);
    return n;
  };

  try {
    const levers = Array.isArray(body?.levers) ? (body?.levers as unknown[]).filter((l): l is string => typeof l === "string" && l.trim() !== "") : undefined;
    const source = body?.source === "peer_benchmark" ? "peer_benchmark" : "user";
    const rawEvidence = body?.price_evidence;
    const priceEvidence = rawEvidence && typeof rawEvidence === "object"
      ? (rawEvidence as Record<string, unknown>)
      : null;
    if (priceEvidence) {
      // The column preserves the citation — an object without one is rejected
      // rather than silently downgraded to manual entry.
      const url = priceEvidence.source_url;
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
        return badRequest("invalid_request", "price_evidence.source_url는 http(s) URL이어야 합니다.");
      }
    }
    const row = recordTargetCostAnalysis(
      getDb(),
      id,
      {
        marketPrice: num("market_price"),
        targetMargin: num("target_margin"),
        estimatedUnitCost: num("estimated_unit_cost"),
        levers,
        source,
        rationale: typeof body?.rationale === "string" ? body.rationale : null,
        priceEvidence: priceEvidence as never,
      },
      auth.auth.userId,
    );
    return ok({ analysis: row, threshold: GAP_THRESHOLD }, 201);
  } catch (err) {
    if (err instanceof TargetCostValidationError) return badRequest("invalid_request", err.message);
    throw err;
  }
}
