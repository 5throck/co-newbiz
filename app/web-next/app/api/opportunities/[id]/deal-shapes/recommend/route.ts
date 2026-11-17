// POST /api/opportunities/[id]/deal-shapes/recommend — S7 deal-shape evaluation AI recommendation (ADR-0118 contract,
// boundary #2). A PROPOSAL only: it never writes a deal-shape verdict (the POST on the parent route stays the only write
// path and always records the calling person). The panel shows the proposals and lets the person copy one into the form;
// the person edits and records. Inputs are limited to the S7 declared evidence: the shortlist, the S6 universe definition,
// the S3 capability gap register and the verdicts already recorded. No grounding (no shortlisted target) -> no LLM call.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import {
  DEAL_SHAPES,
  DEAL_SHAPE_INTENTS,
  listDealShapeEvaluations,
} from "../../../../../../../../db/repositories/opportunity-deal-shape.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { s3CapabilityLines } from "../../../../../../lib/brownfield-universe.ts";
import { dealShapeWriteGuard, DEAL_SHAPE_NOT_OPEN } from "../../../../../../lib/deal-shape-guard.ts";
import { fail, notFound, ok } from "../../../../../../lib/envelope.ts";
import { completeOrFallback, type LlmOrFallback } from "../../../../../../lib/llm.ts";
import { systemMessage } from "../../../../../../lib/prompts.ts";
import { route } from "../../../../../../lib/route.ts";

export const DEAL_SHAPE_RECOMMEND_PROMPT_VERSION = "s7.deal_shape_recommend@1";

export interface ShapeRecommendation {
  shape: string;
  /** null = the evidence neither supports nor blocks the shape; the rationale names the missing data. */
  viable: boolean | null;
  /** Empty when viable is null. */
  intent: string;
  rationale: string;
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Whitelist-clamp the LLM output (never trusted raw): unknown shapes are dropped, one entry per shape, an unknown intent is
 * emptied, a non-boolean verdict becomes null, and an entry without a rationale is dropped (nothing to review).
 * Exported for the pure parse tests.
 */
export function parseShapeRecommendations(raw: Record<string, unknown> | null): ShapeRecommendation[] {
  const list = raw?.recommendations;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ShapeRecommendation[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const shape = str(r.shape, 40);
    if (!(DEAL_SHAPES as readonly string[]).includes(shape) || seen.has(shape)) continue;
    const viable = typeof r.viable === "boolean" ? r.viable : null;
    const intentRaw = str(r.intent, 40);
    const intent = viable !== null && (DEAL_SHAPE_INTENTS as readonly string[]).includes(intentRaw) ? intentRaw : "";
    const rationale = str(r.rationale, 500);
    if (!rationale) continue;
    seen.add(shape);
    out.push({ shape, viable, intent, rationale });
  }
  return out;
}

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Deal-shape recommendation requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { id } = await params;
  const db = getDb();
  const opp = db
    .query("SELECT id, name, capability_gap_json, target_universe_json FROM opportunity WHERE id = ?")
    .get(id) as
    | { id: string; name: string; capability_gap_json: string | null; target_universe_json: string | null }
    | undefined;
  if (!opp) return notFound();
  // Same readiness as recording: brownfield track and S7 reached (a recommendation for a screen that cannot record is noise).
  const refusal = dealShapeWriteGuard(id);
  if (refusal) return fail(409, DEAL_SHAPE_NOT_OPEN, refusal.message, { reason: refusal.reason });

  const shortlist = db
    .query(
      "SELECT company_name, rank, universe_note FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted' ORDER BY rank IS NULL, rank, company_name",
    )
    .all(id) as { company_name: string; rank: number | null; universe_note: string | null }[];
  const manifest: string[] = [`Shortlisted targets: ${shortlist.length}`];
  const base = { manifest, prompt_version: DEAL_SHAPE_RECOMMEND_PROMPT_VERSION };
  if (shortlist.length === 0) {
    return ok(
      {
        ...base,
        source: "synthesis",
        provider: "deterministic",
        note: "no_shortlist",
        recommendations: [],
      },
      200,
      { no_grounding: true },
    );
  }

  const { live } = listDealShapeEvaluations(db, id);
  const recorded = live.map(
    (r) => `- ${r.shape}: ${r.viable ? "viable" : "not viable"} (${r.intent}) — ${r.rationale.slice(0, 160)}`,
  );
  const capability = opp.capability_gap_json ? s3CapabilityLines(opp.capability_gap_json).lines : [];
  if (opp.target_universe_json) manifest.push("S6 target universe definition");
  if (capability.length > 0) manifest.push("S3 required capabilities");
  if (recorded.length > 0) manifest.push(`Recorded deal-shape verdicts: ${recorded.length}`);

  const userContent = [
    `Review item: ${opp.name}`,
    "Shortlist:",
    ...shortlist.map(
      (t) => `- ${t.rank ?? "-"}. ${t.company_name}${t.universe_note ? ` — ${t.universe_note.slice(0, 160)}` : ""}`,
    ),
    opp.target_universe_json
      ? `S6 target universe definition (reference): ${opp.target_universe_json.slice(0, 600)}`
      : "",
    capability.length > 0 ? `S3 required capabilities:\n${capability.join("\n")}` : "",
    recorded.length > 0 ? `Deal-shape verdicts already recorded:\n${recorded.join("\n")}` : "",
    "",
    `Shape codes: ${DEAL_SHAPES.join(", ")}`,
    "Recommend viability for each shape from the evidence above. Return JSON only:",
    '{"recommendations":[{"shape":"shape code","viable":true,"intent":"integration|capability_access","rationale":"1-2 sentences citing the evidence; viable=null plus the missing data when it cannot be judged"}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const llmRes: LlmOrFallback = await completeOrFallback(
    [systemMessage("s7.deal_shape_recommend"), { role: "user" as const, content: userContent }],
    () => "",
    {
      maxTokens: 1200,
      agent: {
        key: "brownfield-agent",
        purpose: "S7 deal-shape evaluation: per-shape viability recommendation (proposal only)",
        contextType: "opportunity",
        contextId: id,
      },
    },
  );

  appendAudit(db, {
    actor: auth.auth.userId,
    action: "deal_shape.recommend",
    target: id,
    now: new Date().toISOString(),
  });

  if (llmRes.source !== "llm") {
    return ok(
      {
        ...base,
        source: "synthesis",
        provider: llmRes.provider,
        note: "llm_unavailable",
        recommendations: [],
      },
      200,
      { no_grounding: true },
    );
  }
  const recommendations = parseShapeRecommendations(parseJson(llmRes.text));
  if (recommendations.length === 0) {
    return ok(
      {
        ...base,
        source: "llm",
        provider: llmRes.provider,
        note: "parse_failed",
        recommendations: [],
      },
      200,
      { parse_failed: true },
    );
  }
  return ok({ ...base, source: "llm", provider: llmRes.provider, note: null, recommendations }, 200, {
    drafted: true,
  });
});
