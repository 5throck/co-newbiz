// 3-stage review (ADR-0153) for the project carrier.
//   GET  ?gate=<gate>  — latest AI 1st / AI 2nd rows for the gate artifact
//                         (three buckets; no PASS stamp).
//   POST {gate}        — (re)run the deterministic AI 1st check.
// Reviews are proposals: nothing here can write a gate decision or approval.
import { route } from "../../../../../lib/route.ts";
import { handleReview } from "../../../../../lib/review/http.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handleReview(request, "project", (await params).id, "view"));

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  handleReview(request, "project", (await params).id, "ai-1st"));
