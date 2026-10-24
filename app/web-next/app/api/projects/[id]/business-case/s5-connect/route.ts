// /api/projects/[id]/business-case/s5-connect - `S5와 연결하기` for a Green Field project (ADR-0178
// follow-up, decider feedback 2026-10-16). GET previews what the connect would change (lines to
// import, skipped lines with reasons, confirmed S5 run, basis / source before and after). POST is
// the ONE confirm: pin (or re-pin) the live S5 plan, set bc.investment_basis to the unified
// `S5 투자 계획` (stored code 2: capex + labor/opex; legacy codes 0 and 1 both move to 2), set
// bc.s5_source = 1 - one transaction, audit `s5_plan_pin.connected`.
// Existing cases / simulations / adopted results are never recalculated. Human only (agent
// principals are rejected, boundary #2), analyst+, deny-by-default visibility, Green Field only,
// 409 `no_importable_lines` when S5 has nothing importable.
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { currentPrincipal } from "../../../../../../lib/mcp/principal-context.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { s5PinStatusForProject } from "../../../../../../lib/s5-plan-pin-s8.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { connectS5, previewS5Connect, S5ConnectError } from "../../../../../../../../db/repositories/s5-connect.ts";
import { S5PinError } from "../../../../../../../../db/repositories/s5-plan-pin.ts";
import { S5ReimportError } from "../../../../../../../../db/repositories/s5-cost-import.ts";

async function guard(request: Request, params: Promise<{ id: string }>) {
  const auth = authenticate(request);
  if (!auth.ok) return { response: auth.response };
  const ctx = auth.auth;
  if (currentPrincipal()) return { response: forbidden("human_only", "Only a human can link to S5 (boundary #2).") };
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Linking to S5 requires the analyst role or higher." });
  if (denied) return { response: denied };
  const { id } = await params;
  if (!visibleProject(ctx, id)) return { response: notFound() };
  return { ctx, id };
}

function s5ConnectErrorResponse(e: unknown) {
  if (e instanceof S5ConnectError || e instanceof S5PinError || e instanceof S5ReimportError) {
    if (e.code === "not_found") return notFound();
    return fail(409, e.code, e.message);
  }
  throw e;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(request, params);
  if ("response" in g) return g.response;
  try {
    return ok({ preview: previewS5Connect(getDb(), g.id) });
  } catch (e) {
    return s5ConnectErrorResponse(e);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(request, params);
  if ("response" in g) return g.response;
  try {
    const db = getDb();
    const result = connectS5(db, g.id, g.ctx!.userId);
    return ok({ ...result, status: s5PinStatusForProject(db, g.id) }, 200, { pin_written: String(result.pin_written) });
  } catch (e) {
    return s5ConnectErrorResponse(e);
  }
}
