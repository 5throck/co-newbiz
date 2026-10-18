// POST /api/synergy/analyses/[id]/rescore — ADR-0182 (2026-10-18 decider
// request): converts a legacy 4-factor stored payload to the current scoring
// scheme without a full pipeline rerun. Appends a NEW analysis version
// (append-only) and re-records the opportunity recommendation under the rerun
// rule (a changed score invalidates the person's confirmation). Analyst+
// initiated; the LLM adjustment stays ±10-bounded and draft-grade.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { fail, notFound, ok } from "../../../../../../lib/envelope.ts";
import { rescoreLatestVersion, type RescoreError } from "../../../../../../lib/synergy-rescore.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "체계 전환 재계산은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM synergy_analysis WHERE id = ?").get(id)) return notFound();
  try {
    const result = await rescoreLatestVersion(db, id, ctx.userId);
    appendAudit(db, { actor: ctx.userId, action: "synergy.rescore", target: `${id}:v${result.versionNo}`, now: new Date().toISOString() });
    return ok({ ...result, message: `v${result.versionNo}로 재계산했습니다 — 권고 ${result.score ?? "산출 불가"}점 (${result.method}). 점수가 바뀌면 기존 사람 확정은 무효화됩니다.` }, 201);
  } catch (err) {
    const code = err instanceof Error ? (err.message as RescoreError) : "";
    if (code === "ANALYSIS_NOT_FOUND") return notFound();
    if (code === "NO_OPPORTUNITY") return fail(400, "no_opportunity", "연결 기회가 없는 분석은 재계산할 수 없습니다 — 기회 연결 후 이용하세요.");
    if (code === "NO_LATEST_VERSION") return fail(400, "no_latest_version", "저장된 분산 결과가 없습니다 — 먼저 분석을 완료하세요.");
    return fail(500, "rescore_failed", `재계산 실패 — ${err instanceof Error ? err.message.slice(0, 120) : "알 수 없는 오류"}`);
  }
}
