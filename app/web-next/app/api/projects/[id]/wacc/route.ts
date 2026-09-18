// GET/POST /api/projects/[id]/wacc — Wave C1 WACC input session; ADR-0115
// adds the CAPM component layer. GET exposes the confirmed WACC/hurdle
// provenance PLUS the persisted `wacc.*` components and the derivation
// re-assembled from them. POST records confirmed kind='user' rows through
// db/lib/wacc.ts, creating a versioned run snapshot; mode="capm" requires a
// derivable component set and returns the server-computed WACC alongside the
// human-confirmed one.
import { getDb } from "../../../../../../../db/client.ts";
import { isWaccSubject, loadProjectComponents, recordWaccSession, resolveProjectHurdleIrr, resolveProjectWacc, resolveProjectWaccSubject, resolveReleveredBeta, setProjectWaccSubject } from "../../../../../../../db/lib/wacc.ts";
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
  const wacc = resolveProjectWacc(db, id);
  const hurdle = resolveProjectHurdleIrr(db, id);
  const { runId, components } = loadProjectComponents(db, id);
  const derivation = components.length > 0 ? assembleDerivation(components) : null;
  const subject = resolveProjectWaccSubject(db, id);
  const relevering = subject.subject !== "promoter" ? resolveReleveredBeta(db, id) : null;
  return ok(
    { wacc, hurdle_irr: hurdle, components, derivation, subject, relevering },
    200,
    { wacc_source: wacc.source, run_id: wacc.run_id ?? undefined, components_run_id: runId ?? undefined },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "WACC 입력 세션은 analyst 역할 이상이어야 합니다.");
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
  } | null;
  const wacc = parseRate(body?.wacc);
  if (wacc === null) return badRequest("invalid_request", "wacc는 -1보다 큰 유한한 비율이어야 합니다. 예: 0.095");
  const hasHurdle = body?.hurdle_irr !== undefined && body?.hurdle_irr !== null && body?.hurdle_irr !== "";
  const hurdleIrr = hasHurdle ? parseRate(body?.hurdle_irr) : null;
  if (hasHurdle && hurdleIrr === null) {
    return badRequest("invalid_request", "hurdle_irr는 -1보다 큰 유한한 비율이어야 합니다.");
  }

  let components: WaccComponentInput[] | undefined;
  let derivation: ReturnType<typeof assembleDerivation> | null = null;
  if (body?.components !== undefined) {
    if (body?.mode !== "capm") {
      return badRequest("invalid_request", "components는 mode='capm' 세션에서만 허용됩니다.");
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
      return badRequest("invalid_request", `CAPM 컴포넌트가 부족합니다: ${gaps.join(", ")}`);
    }
    derivation = assembleDerivation(components);
  }

  let subjectInput: { subject: "promoter" | "target" | "project_newco"; rationale: string } | null = null;
  if (body?.subject !== undefined && body?.subject !== null && body?.subject !== "") {
    if (!isWaccSubject(body.subject)) {
      return badRequest("invalid_request", "subject는 promoter | target | project_newco 중 하나여야 합니다.");
    }
    const subjectRationale = typeof body.subject_rationale === "string" ? body.subject_rationale.trim() : "";
    if (!subjectRationale) {
      return badRequest("invalid_request", "wacc 주체를 확정할 때는 근거(subject_rationale)가 필요합니다.");
    }
    subjectInput = { subject: body.subject, rationale: subjectRationale };
  }

  try {
    const result = recordWaccSession(getDb(), {
      projectId: id,
      wacc,
      hurdleIrr,
      mode: body?.mode,
      rationale: body?.rationale,
      anchorRef: body?.anchor_ref,
      asOf: body?.as_of,
      components,
      actor: auth.auth.userId,
    });
    if (subjectInput) {
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
    return badRequest("wacc_session_failed", err instanceof Error ? err.message : "WACC 입력 세션 저장에 실패했습니다.");
  }
}
