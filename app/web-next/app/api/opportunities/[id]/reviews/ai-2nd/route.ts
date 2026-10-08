// POST {gate} — on-demand AI 2nd (cross-domain LLM) review of a gate artifact
// (ADR-0153 §4.5-4.7). Runs as the calling user; a cache hit makes no LLM
// call; a missing reviewer / LLM / exhausted token cap is recorded as "not
// performed". Never writes a gate decision or approval (boundary #2).
import { route } from "../../../../../../lib/route.ts";
import { handleReview } from "../../../../../../lib/review/http.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handleReview(request, "opportunity", (await params).id, "ai-2nd"));
