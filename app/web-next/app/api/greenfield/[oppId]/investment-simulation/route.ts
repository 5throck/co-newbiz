// ADR-0176 slice 2: run/save and fetch the latest S5 investment simulation.
// Decision support only - no gate block, no grade effect; the person owns every input. The
// simulation always reads the SAVED plan (incl. saved assumption ranges); unsaved page edits are
// never simulated. Person-entered input (envelope, draws) is hard-400 when invalid, never dropped.
import { getDb } from "../../../../../../../db/client.ts";
import { getLatestInvestmentSimulationRun, insertInvestmentSimulationRun } from "../../../../../../../db/repositories/investment-simulation-run.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, fail, migrationPendingResponse, notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";
import { scenarioSeed } from "../../../../../lib/business-case-generator.ts";
import { clampDraws, simulateInvestment, simulationInputHash, validateEnvelope, type SimulationResults } from "../../../../../lib/investment-simulation.ts";
import { loadInvestmentVectorsInput } from "../../../../../lib/investment-simulation-input.ts";
import { trackConflictResponse } from "../../../../../lib/route-track-guard.ts";

const BODY_KEYS = ["envelope_krw_m", "draws"];

/** A viewer must not infer salary levels: the staffing category band is withheld for read-only callers. */
const maskForViewer = (results: SimulationResults): unknown => ({ ...results, byCategory: { ...results.byCategory, staffing: null }, staffing_masked: true });

export const GET = route(async (request: Request, { params }: { params: Promise<{ oppId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  if (!db.query("SELECT 1 FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  try {
    const run = getLatestInvestmentSimulationRun(oppId, db);
    if (!run) return ok({ run: null, stale: false }, 200);
    // stale = the saved plan (or its saved ranges) no longer hashes to the run's input_hash.
    const input = loadInvestmentVectorsInput(db, oppId);
    const stale = !input || simulationInputHash(input, run.seed, run.draw_count) !== run.input_hash;
    const viewer = auth.auth.role === "viewer";
    return ok({ run: viewer ? { ...run, results: maskForViewer(run.results as SimulationResults) } : run, stale }, 200);
  } catch (e) {
    const pending = migrationPendingResponse(e);
    if (pending) return pending;
    throw e;
  }
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ oppId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "투자 시뮬레이션 실행은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { oppId } = await params;
  const raw = await request.json().catch(() => undefined);
  const body = raw === undefined ? {} : raw;
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("invalid_request", "요청 본문 형식이 올바르지 않습니다.");
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !BODY_KEYS.includes(k));
  if (unknown.length > 0) return badRequest("invalid_request", `알 수 없는 항목: ${unknown.join(", ")}`);
  const envErr = validateEnvelope(b.envelope_krw_m);
  if (envErr) return badRequest("invalid_envelope", envErr);
  if (b.draws !== undefined && b.draws !== null && (typeof b.draws !== "number" || !Number.isFinite(b.draws))) return badRequest("invalid_draws", "추출 횟수는 숫자여야 합니다 (100~5,000으로 보정됩니다).");
  const db = getDb();
  if (!db.query("SELECT 1 FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  // T-20261022-038: the run stays decision-support only (no gate block, no grade
  // effect — see the header above), but S5 simulation is a greenfield-only write.
  // The client gates it with TrackGate, yet the server must not trust that — a
  // brownfield route decision makes the run 409 not_applicable_track (mirror of
  // T-20261022-007's S5 guard). No route decision yet stays runnable, same
  // back-compat choice as the S5 assessment route.
  const conflict = trackConflictResponse(
    db, oppId, "greenfield",
    "S5 투자 시뮬레이션은 Greenfield Route에서만 실행할 수 있습니다 — 이 기회의 현재 Route 결정은 Brownfield입니다.",
  );
  if (conflict) return conflict;
  const input = loadInvestmentVectorsInput(db, oppId);
  if (!input) return fail(409, "no_investment_plan", "저장된 투자 계획이 없습니다 — 투자비 항목을 저장한 뒤 실행하세요.");
  const draws = clampDraws(b.draws as number | null | undefined);
  const seed = scenarioSeed(oppId, "investment_simulation");
  const envelope = typeof b.envelope_krw_m === "number" ? b.envelope_krw_m : null;
  const results = simulateInvestment({ ...input, seed, draws, envelopeKrwM: envelope });
  try {
    const run = insertInvestmentSimulationRun({
      opportunityId: oppId,
      inputHash: simulationInputHash(input, seed, draws),
      seed,
      drawCount: draws,
      horizonYears: results.horizon,
      envelopeKrwM: envelope,
      assumptions: results.assumptions,
      results,
      actor: auth.auth.userId,
      now: new Date().toISOString(),
    }, db);
    return ok({ run, stale: false }, 201);
  } catch (e) {
    const pending = migrationPendingResponse(e);
    if (pending) return pending;
    throw e;
  }
});
