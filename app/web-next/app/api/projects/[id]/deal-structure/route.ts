// S10 투자구조 설계 (flow.spec v2.2.0) — GET: the deal-structure hypotheses
// (ADR-0045 four-axis vehicle review) plus the financing plan (sources &
// uses, migration 0075); POST: one action endpoint for the two deliberate
// writes — hypothesize/complete-four-axis via the governance repository,
// add/remove financing lines via the financing-plan repository. Member-
// visible only (FR-SEC-01); the four-axis completion flag has exactly one
// setter and demands an artifact reference — the route just forwards to it.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import {
  completeFourAxisReview,
  getHypotheses,
  hypothesize,
  type HypothesisRow,
} from "../../../../../../../db/repositories/deal-structure-hypothesis.repository.ts";
import {
  addFinancingEntry,
  financingTotals,
  listFinancingEntries,
  removeFinancingEntry,
} from "../../../../../../../db/repositories/financing-plan.repository.ts";
import { badRequest, notFound, ok, forbidden } from "../../../../../lib/envelope.ts";
import { recordHumanFinalForStageArtifacts } from "../../../../../lib/review/human-final.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

interface DealStructureView {
  hypotheses: HypothesisRow[];
  financing: {
    entries: ReturnType<typeof listFinancingEntries>;
    totals: ReturnType<typeof financingTotals>;
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const view: DealStructureView = {
    hypotheses: getHypotheses(id, db),
    financing: { entries: listFinancingEntries(id, db), totals: financingTotals(id, db) },
  };
  return ok(view, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "투자구조 설계 기록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;

  try {
    if (action === "hypothesize") {
      const row = hypothesize(
        {
          project_id: id,
          run_id: (body?.run_id as string | undefined) ?? null,
          asset_or_stock: body?.asset_or_stock as HypothesisRow["asset_or_stock"],
          stake_type: body?.stake_type as HypothesisRow["stake_type"],
          instrument_mix: body?.instrument_mix as HypothesisRow["instrument_mix"],
          vehicle: body?.vehicle as HypothesisRow["vehicle"],
          commercialization_path: body?.commercialization_path as HypothesisRow["commercialization_path"],
          tax_structure_note: (body?.tax_structure_note as string | undefined) ?? null,
          liability_isolation_note: (body?.liability_isolation_note as string | undefined) ?? null,
          financing_leverage_note: (body?.financing_leverage_note as string | undefined) ?? null,
          exit_structure_note: (body?.exit_structure_note as string | undefined) ?? null,
          hypothesized_by: ctx.userId,
          rationale: (body?.rationale as string | undefined) ?? "",
        },
        db,
      );
      return ok(row, 201);
    }
    if (action === "complete_four_axis") {
      const hypothesisId = body?.hypothesis_id as string | undefined;
      const artifactRef = body?.artifact_ref as string | undefined;
      if (!hypothesisId || !artifactRef?.trim()) {
        return badRequest("invalid_request", "hypothesis_id와 artifact_ref(deal_structure_review 아티팩트 참조)는 필수입니다.");
      }
      const row = completeFourAxisReview({ hypothesis_id: hypothesisId, reviewed_by: ctx.userId, artifact_ref: artifactRef.trim() }, db);
      // ADR-0153: the human's four-axis completion (reviewed_by recorded) is the
      // human_final review of the S10 artifacts.
      recordHumanFinalForStageArtifacts("S10", id, ctx.userId, "deal_structure_four_axis");
      return ok(row, 200);
    }
    if (action === "add_financing_entry") {
      const kind = body?.kind as string | undefined;
      if (kind !== "source" && kind !== "use") return badRequest("invalid_request", "kind은 source 또는 use여야 합니다.");
      const row = addFinancingEntry(
        {
          project_id: id,
          kind,
          name: (body?.name as string | undefined) ?? "",
          amount_krw_m: Number(body?.amount_krw_m),
          note: (body?.note as string | undefined) ?? null,
          created_by: ctx.userId,
        },
        db,
      );
      return ok(row, 201);
    }
    if (action === "remove_financing_entry") {
      const entryId = body?.entry_id as string | undefined;
      if (!entryId) return badRequest("invalid_request", "entry_id는 필수입니다.");
      const removed = removeFinancingEntry(id, entryId, ctx.userId, db);
      if (!removed) return notFound();
      return ok({ ok: true }, 200);
    }
    return badRequest("invalid_action", "action은 hypothesize | complete_four_axis | add_financing_entry | remove_financing_entry 중 하나여야 합니다.");
  } catch (err) {
    return badRequest("deal_structure_write_failed", err instanceof Error ? err.message : "Deal-structure write failed.");
  }
}
