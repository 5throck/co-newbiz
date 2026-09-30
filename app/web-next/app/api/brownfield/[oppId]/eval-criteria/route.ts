// S7 재무·기술 평가 카탈로그 (ADR-0139) — 목록(+lazy 시딩) / 커스텀 항목 추가.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { addCustomCriterion, listOrSeedCriteria } from "../../../../../lib/brownfield-eval-criteria.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { oppId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  const criteria = listOrSeedCriteria(oppId, auth.auth.userId, db);
  return ok({ criteria }, 200, { count: criteria.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "평가 항목 추가는 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  const body = (await request.json().catch(() => null)) as { category?: string; label?: string; description?: string; weight?: number } | null;
  if (body?.category !== "financial" && body?.category !== "technical") {
    return badRequest("invalid_request", "category는 financial | technical 중 하나입니다.");
  }
  const label = body?.label?.trim();
  if (!label) return badRequest("invalid_request", "label은 필수입니다.");
  const weight = typeof body.weight === "number" && Number.isFinite(body.weight) && body.weight > 0 ? Math.round(body.weight) : undefined;
  const criterion = addCustomCriterion(oppId, body.category, label, body.description?.trim() || null, auth.auth.userId, weight);
  return ok(criterion, 201);
}
