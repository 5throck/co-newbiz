// S7 재무·기술 평가 카탈로그 (ADR-0139) — 목록(+lazy 시딩) / 커스텀 항목 추가.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { addCustomCriterion, listOrSeedCriteria } from "../../../../../lib/brownfield-eval-criteria.ts";
import { trackConflictResponse } from "../../../../../lib/route-track-guard.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  const criteria = listOrSeedCriteria(oppId, auth.auth.userId, db);
  return ok({ criteria }, 200, { count: criteria.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Evaluation-item additions require the analyst role or higher." });
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  // T-20261022-038: S7 is a brownfield-only write surface. The client gates it with
  // TrackGate, but the server must not trust that — a greenfield route decision makes
  // the save 409 not_applicable_track (mirror of T-20261022-007's S5 guard). No route
  // decision yet stays writable, same back-compat choice as the S5 route.
  const conflict = trackConflictResponse(
    db, oppId, "brownfield",
    "S7 재무·기술 평가 항목 관리는 Brownfield Route에서만 할 수 있습니다 — 이 기회의 현재 Route 결정은 Greenfield입니다.",
  );
  if (conflict) return conflict;
  const body = (await request.json().catch(() => null)) as { category?: string; label?: string; description?: string; weight?: number } | null;
  if (body?.category !== "financial" && body?.category !== "technical") {
    return badRequest("invalid_request", "category must be one of: financial | technical.");
  }
  const label = body?.label?.trim();
  if (!label) return badRequest("invalid_request", "label is required.");
  const weight = typeof body.weight === "number" && Number.isFinite(body.weight) && body.weight > 0 ? Math.round(body.weight) : undefined;
  const criterion = addCustomCriterion(oppId, body.category, label, body.description?.trim() || null, auth.auth.userId, weight);
  return ok(criterion, 201);
}
