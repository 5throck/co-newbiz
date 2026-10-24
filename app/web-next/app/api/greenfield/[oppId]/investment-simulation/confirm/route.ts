// ADR-0176 slice 3: a person confirms an S5 investment simulation run so S8 may consume it
// (Decision 5/7: S8 reads only the latest CONFIRMED run). Human-only (boundary #2): a cookie session
// of a non-agent account - never a bearer token, never the in-process MCP principal. Audited as
// investment_simulation.confirmed (actor, seed, draws, input_hash). A stale run (the saved plan or
// ranges no longer hash to it) is rejected: a person confirms what they read on the current plan.
// Decision support only: no gate block, no grade effect.
import { getDb } from "../../../../../../../../db/client.ts";
import { confirmInvestmentSimulationRun, getInvestmentSimulationRun } from "../../../../../../../../db/repositories/investment-simulation-run.repository.ts";
import { authenticate, humanOnlyDenied, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, fail, migrationPendingResponse, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";
import { simulationInputHash } from "../../../../../../lib/investment-simulation.ts";
import { loadInvestmentVectorsInput } from "../../../../../../lib/investment-simulation-input.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ oppId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Investment-simulation confirmation requires the analyst role or higher." });
  if (denied) return denied;
  const human = humanOnlyDenied(auth.auth, "투자 시뮬레이션 가정 확정은 사람만 할 수 있습니다 (boundary #2).");
  if (human) return human;
  const { oppId } = await params;
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return badRequest("invalid_request", "Malformed request body.");
  const b = raw as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => k !== "run_id");
  if (unknown.length > 0) return badRequest("invalid_request", `Unknown items: ${unknown.join(", ")}`);
  if (typeof b.run_id !== "string" || b.run_id.trim() === "") return badRequest("invalid_request", "run_id is required.");
  const db = getDb();
  if (!db.query("SELECT 1 FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  try {
    const run = getInvestmentSimulationRun(oppId, b.run_id, db);
    if (!run) return notFound();
    const input = loadInvestmentVectorsInput(db, oppId);
    if (!input || simulationInputHash(input, run.seed, run.draw_count) !== run.input_hash) {
      return fail(409, "stale_run", "The stored investment plan or assumption scope changed after this run — run again and confirm.");
    }
    const result = confirmInvestmentSimulationRun(oppId, run.id, auth.auth.userId, new Date().toISOString(), db);
    if (!result.ok) return result.reason === "already_confirmed" ? fail(409, "already_confirmed", "This run is already confirmed.") : notFound();
    return ok({ run: result.run, stale: false }, 200);
  } catch (e) {
    const pending = migrationPendingResponse(e);
    if (pending) return pending;
    throw e;
  }
});
