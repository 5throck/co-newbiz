// POST /api/projects/[id]/dd-checklist/custom — a person proposes one custom
// DD checklist item on any of the seven S9 domains (ADR-0099, ADR-0148,
// migration 0137). The item is written as 'proposed' with no state row, so it
// cannot count toward S9 until the human review route approves it (boundary
// #2). This is the only custom-item path for financial/hr/market/financing,
// which have no industry-tailoring templates. Analyst+; deny-by-default
// visibility; for projects created before 2026-10-01 items on those four
// domains are recorded for reference (not counted in S9 completion).
// HUMAN-ONLY: cookie session + no agent principal (HUMAN_ONLY_ROUTES); the
// proposer is recorded as the actor of the dd_custom_item.create audit entry
// so the review route can require a different reviewer.
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import {
  createDdCustomItem,
  isDdDomain,
  DD_DOMAINS,
  MAX_ITEM_LABEL_LEN,
  MAX_RATIONALE_LEN,
  validSourceUrl,
} from "../../../../../../lib/dd-checklist-tailor.ts";
import { AGENT_KEYS } from "../../../../../../lib/agent-registry.generated.ts";
import { currentPrincipal } from "../../../../../../lib/mcp/principal-context.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { DdTargetError } from "../../../../../../lib/dd-target.ts";
import { ddTargetErrorResponse, scopeOrResponse } from "../../../../../../lib/dd-target-http.ts";

const RELIABILITY = ["A", "B", "C"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "Only a human can directly propose custom checklist items — agent proposals go through the tailor path.");
  }
  if (ctx.role === "viewer") return forbidden("role_required", "Proposing custom checklist items requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    domain?: string;
    item_label?: string;
    rationale?: string;
    source_url?: string;
    source_reliability?: string;
    target_id?: string;
  } | null;
  if (!body?.domain || !isDdDomain(body.domain)) {
    return badRequest("invalid_request", `domain must be one of: ${DD_DOMAINS.join(" | ")}.`);
  }
  if (typeof body.item_label !== "string" || !body.item_label.trim()) return badRequest("invalid_request", "item_label is required.");
  if (body.item_label.trim().length > MAX_ITEM_LABEL_LEN) return badRequest("invalid_request", `item_label must be at most ${MAX_ITEM_LABEL_LEN} characters.`);
  if (body.rationale != null && (typeof body.rationale !== "string" || body.rationale.trim().length > MAX_RATIONALE_LEN)) {
    return badRequest("invalid_request", `rationale must be a string of at most ${MAX_RATIONALE_LEN} characters.`);
  }
  if (!validSourceUrl(body.source_url)) return badRequest("invalid_request", "source_url must be an http(s) URL of at most 2000 characters.");
  if (body.source_reliability != null && !(RELIABILITY as readonly string[]).includes(body.source_reliability)) {
    return badRequest("invalid_request", "source_reliability must be one of: A | B | C.");
  }
  const scope = scopeOrResponse(id, body.target_id);
  if ("response" in scope) return scope.response;
  try {
    const result = createDdCustomItem(id, {
      domain: body.domain,
      itemLabel: body.item_label,
      rationale: body.rationale ?? null,
      sourceUrl: body.source_url ?? null,
      sourceReliability: (body.source_reliability as (typeof RELIABILITY)[number] | undefined) ?? null,
      targetId: scope.targetId,
      actor: ctx.userId,
    });
    return ok(result, 201);
  } catch (err) {
    if (err instanceof DdTargetError) return ddTargetErrorResponse(err);
    throw err;
  }
}
