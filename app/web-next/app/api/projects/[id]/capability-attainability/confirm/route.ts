// POST /api/projects/[id]/capability-attainability/confirm — HUMAN-ONLY (ADR-0168,
// boundary #2). Green Field: 410 moved (editAt S5, ADR-0171; use the opportunity confirm route);
// Brown Field: 410 moved (editAt S7, ADR-0171 slice 2; use POST /api/brownfield/targets/{targetId}/capability-judgements/confirm). A person confirms the attainability judgements they (or an agent
// draft) recorded: sets confirmedBy/confirmedAt on judged rows. Cookie session of
// a non-agent account only; bearer / OAuth-delegated MCP / agent callers get 403
// human_only (also in HUMAN_ONLY_ROUTES). Body: { row_ids?: string[] } (default:
// every judged, unconfirmed row). analyst+ member. Audit
// capability_attainability.confirm, target "<projectId>#capability@<via>".
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, humanOnlyDenied, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { moved, notFound } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { editStageOf } from "../../../../../../lib/capability-attainability.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = humanOnlyDenied(ctx, "필요 역량 달성 가능성의 확정은 사람만 할 수 있습니다 (boundary #2) — 에이전트는 초안만 저장합니다.");
  if (denied) return denied;
  { const d = requireBusinessActor(ctx, "write", { viewerMessage: "Attainability confirmation requires the analyst role or higher." }); if (d) return d; }
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  if (editStageOf(getDb(), id).editAt === "S5") return moved("Confirming capability attainability has moved to S5 — confirm it there (POST /api/opportunities/{id}/capability-attainability/confirm).", "S5");
  return moved("Confirming capability attainability has moved to the S7 per-target check — confirm it there (POST /api/brownfield/targets/{targetId}/capability-judgements/confirm).", "S7");
}
