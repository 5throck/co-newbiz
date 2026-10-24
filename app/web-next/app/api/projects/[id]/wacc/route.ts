// GET/POST /api/projects/[id]/wacc — Wave C1 WACC input session; ADR-0115
// adds the CAPM component layer. GET exposes the confirmed WACC/hurdle
// provenance PLUS the persisted `wacc.*` components and the derivation
// re-assembled from them. POST records confirmed kind='user' rows through
// db/lib/wacc.ts, creating a versioned run snapshot; mode="capm" requires a
// derivable component set and returns the server-computed WACC alongside the
// human-confirmed one.
import { getDb } from "../../../../../../../db/client.ts";
import { isWaccSubject, listProjectAnalysisTargets, loadProjectComponents, recordWaccSession, resolveProjectHurdleIrr, resolveProjectWacc, resolveProjectWaccSubject, resolveReleveredBeta, setProjectWaccSubject, type WaccScope } from "../../../../../../../db/lib/wacc.ts";
import {
  assembleDerivation,
  capmComponentGaps,
  validateComponentInput,
  WaccComponentValidationError,
  type WaccComponentInput,
  type WaccComponentKey,
} from "../../../../../../../db/lib/wacc-components.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

/** Confirmed-vs-computed tolerance: half a basis point. */
const COMPUTED_TOLERANCE = 0.00005;

/** ADR-0156: `?target_id=` scopes the view to that shortlisted target's own
 *  sessions; absent = project-level (the fs-gate figure). Throws on an
 *  unknown/unanalyzable target — callers map that to badRequest. */
async function analysisScope(db: ReturnType<typeof getDb>, projectId: string, request: Request): Promise<WaccScope & { targetId?: string }> {
  const targetId = new URL(request.url).searchParams.get("target_id") ?? undefined;
  if (!targetId) return {};
  const target = listProjectAnalysisTargets(db, projectId).find((t) => t.targetId === targetId);
  if (!target || !target.companyId) {
    throw new Error(`target_id '${targetId}' is not a shortlisted target with a resolvable company.`);
  }
  return { subjectCompanyId: target.companyId, targetId };
}

function parseRate(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n > -1 ? n : null;
}

function parseComponents(raw: unknown): WaccComponentInput[] {
  if (!Array.isArray(raw)) throw new WaccComponentValidationError("invalid_request", "components must be an array.");
  return raw.map((c) => {
    const item = c as { key?: unknown; value?: unknown; kind?: unknown; source_label?: unknown; anchor_ref?: unknown; as_of?: unknown; rationale?: unknown };
    if (typeof item.key !== "string" || typeof item.value !== "number" || typeof item.kind !== "string") {
      throw new WaccComponentValidationError("invalid_request", "each component needs { key, value, kind }.");
    }
    return {
      key: item.key as WaccComponentKey,
      value: item.value,
      kind: item.kind as WaccComponentInput["kind"],
      sourceLabel: typeof item.source_label === "string" ? item.source_label : undefined,
      anchorRef: typeof item.anchor_ref === "string" ? item.anchor_ref : null,
      asOf: typeof item.as_of === "string" ? item.as_of : undefined,
      rationale: typeof item.rationale === "string" ? item.rationale : undefined,
    };
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  let scope: WaccScope;
  try {
    scope = await analysisScope(db, id, request);
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : "Invalid target_id.");
  }
  const wacc = resolveProjectWacc(db, id, scope);
  const hurdle = resolveProjectHurdleIrr(db, id, scope);
  const { runId, components } = loadProjectComponents(db, id, scope);
  const derivation = components.length > 0 ? assembleDerivation(components) : null;
  const subject = resolveProjectWaccSubject(db, id);
  const relevering = subject.subject !== "promoter" ? resolveReleveredBeta(db, id, scope) : null;
  return ok(
    { wacc, hurdle_irr: hurdle, components, derivation, subject, relevering },
    200,
    { wacc_source: wacc.source, run_id: wacc.run_id ?? undefined, components_run_id: runId ?? undefined },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "WACC input sessions require the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    wacc?: unknown;
    hurdle_irr?: unknown;
    mode?: string;
    rationale?: string;
    anchor_ref?: string;
    as_of?: string;
    components?: unknown;
    subject?: unknown;
    subject_rationale?: unknown;
    target_id?: unknown;
  } | null;
  const wacc = parseRate(body?.wacc);
  const hasTarget = typeof body?.target_id === "string" && body.target_id.trim() !== "";
  let scope: WaccScope = {};
  if (hasTarget) {
    const target = listProjectAnalysisTargets(getDb(), id).find((t) => t.targetId === String(body!.target_id).trim());
    if (!target || !target.companyId) {
      return badRequest("invalid_request", "target_id must be a shortlisted target (a company that can be analyzed).");
    }
    scope = { subjectCompanyId: target.companyId };
  }
  if (wacc === null) return badRequest("invalid_request", "wacc must be a finite ratio greater than -1. Example: 0.095");
  const hasHurdle = body?.hurdle_irr !== undefined && body?.hurdle_irr !== null && body?.hurdle_irr !== "";
  const hurdleIrr = hasHurdle ? parseRate(body?.hurdle_irr) : null;
  if (hasHurdle && hurdleIrr === null) {
    return badRequest("invalid_request", "hurdle_irr must be a finite ratio greater than -1.");
  }

  let components: WaccComponentInput[] | undefined;
  let derivation: ReturnType<typeof assembleDerivation> | null = null;
  if (body?.components !== undefined) {
    if (body?.mode !== "capm") {
      return badRequest("invalid_request", "components are allowed only in mode='capm' sessions.");
    }
    try {
      components = parseComponents(body.components);
      for (const comp of components) validateComponentInput(comp);
    } catch (err) {
      if (err instanceof WaccComponentValidationError) return badRequest(err.code, err.message);
      throw err;
    }
    const gaps = capmComponentGaps(components);
    if (gaps.length > 0) {
      return badRequest("invalid_request", `Missing CAPM components: ${gaps.join(", ")}`);
    }
    derivation = assembleDerivation(components);
  }

  let subjectInput: { subject: "promoter" | "target" | "project_newco"; rationale: string } | null = null;
  if (body?.subject !== undefined && body?.subject !== null && body?.subject !== "") {
    if (!isWaccSubject(body.subject)) {
      return badRequest("invalid_request", "subject must be one of: promoter | target | project_newco.");
    }
    const subjectRationale = typeof body.subject_rationale === "string" ? body.subject_rationale.trim() : "";
    if (!subjectRationale) {
      return badRequest("invalid_request", "Confirming the WACC subject requires a basis (subject_rationale).");
    }
    subjectInput = { subject: body.subject, rationale: subjectRationale };
  }

  try {
    const result = recordWaccSession(getDb(), {
      projectId: id,
      wacc,
      hurdleIrr,
      mode: body?.mode,
      rationale: typeof body?.rationale === "string" ? body.rationale : null,
      anchorRef: typeof body?.anchor_ref === "string" ? body.anchor_ref : null,
      asOf: typeof body?.as_of === "string" ? body.as_of : null,
      components,
      subjectCompanyId: scope.subjectCompanyId ?? null,
      actor: auth.auth.userId,
    });
    // REQ-W4 (2026-09-18 S8 design): the WACC application subject is a
    // project-level decision — per-target sessions never write it.
    if (subjectInput && !hasTarget) {
      setProjectWaccSubject(getDb(), id, subjectInput.subject, subjectInput.rationale, auth.auth.userId);
    }
    const subject = resolveProjectWaccSubject(getDb(), id);
    const computed = derivation?.computed.wacc ?? null;
    return ok(
      {
        ...result,
        wacc_computed: computed,
        computed_mismatch: computed != null && Math.abs(computed - wacc) > COMPUTED_TOLERANCE,
        subject,
      },
      201,
      { run_id: result.run_id, wacc_source: result.wacc.source },
    );
  } catch (err) {
    if (err instanceof WaccComponentValidationError) return badRequest(err.code, err.message);
    return badRequest("wacc_session_failed", err instanceof Error ? err.message : "Failed to save the WACC input session.");
  }
}
