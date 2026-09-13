// S3 우선 시너지 영역 — 판정·사유 사람 편집 + 새 영역 추가 (ADR-0125).
// 경계 #2: LLM은 선별을 "제안"할 뿐, 최종 판정(선별/보류)과 그 사유는
// 사람이 정한다. LLM이 제안한 영역의 판정을 사람이 고쳐도 origin은 'llm'
// 그대로 둔다(제안 출처를 지우지 않음) — 편집 사실은 updated_by/at에 남는다.
// 사람이 새 영역을 추가하면 origin은 'human'이다.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";

interface SynergyPayloadShape { shortList?: Array<{ area: string }> }

export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "우선 시너지 영역 판정 편집은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const db = getDb();
  const analysis = db.query("SELECT id FROM synergy_analysis WHERE id = ?").get(id) as { id: string } | null;
  if (!analysis) return notFound();

  const body = (await request.json().catch(() => null)) as { area?: string; verdict?: string; reason?: string } | null;
  const area = body?.area?.trim();
  const verdict = body?.verdict?.trim();
  const reason = body?.reason?.trim();
  if (!area) return badRequest("invalid_request", "area는 필수입니다.");
  if (!verdict) return badRequest("invalid_request", "verdict는 필수입니다.");
  if (!reason) return badRequest("invalid_request", "reason은 필수입니다.");

  // 이 영역이 최신 LLM 산출(payload.shortList)에 이미 있었는지로 origin을 정한다.
  const latest = db.query("SELECT payload FROM synergy_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1").get(id) as { payload: string } | null;
  let payload: SynergyPayloadShape | null = null;
  try { payload = latest ? (JSON.parse(latest.payload) as SynergyPayloadShape) : null; } catch { payload = null; }
  const llmAreas = new Set((payload?.shortList ?? []).map((s) => s.area));

  const now = new Date().toISOString();
  const existing = db.query("SELECT id, origin FROM synergy_shortlist_curation WHERE analysis_id = ? AND area = ?").get(id, area) as { id: string; origin: string } | null;

  if (existing) {
    db.run(
      "UPDATE synergy_shortlist_curation SET verdict = ?, reason = ?, updated_by = ?, updated_at = ? WHERE id = ?",
      [verdict, reason, ctx.userId, now, existing.id],
    );
    appendAudit(db, { actor: ctx.userId, action: "synergy.shortlist_item_edit", target: `${id}:${area}`, now });
    return ok({ id: existing.id, origin: existing.origin }, 200);
  }

  const origin = llmAreas.has(area) ? "llm" : "human";
  const curationId = ulid();
  // origin='llm'인 첫 큐레이션 행 자체가 "사람이 LLM 제안을 고쳤다"는 사건이므로
  // updated_by/at도 함께 채운다 — 그래야 화면에서 "LLM 제안 · 사람 수정"을
  // 첫 편집부터 바로 보여줄 수 있다. origin='human'(새 영역)은 편집 이력이
  // 아니라 생성이므로 updated_by/at을 남기지 않는다.
  db.run(
    `INSERT INTO synergy_shortlist_curation (id, analysis_id, area, origin, verdict, reason, created_by, created_at, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [curationId, id, area, origin, verdict, reason, ctx.userId, now, origin === "llm" ? ctx.userId : null, origin === "llm" ? now : null],
  );
  appendAudit(db, { actor: ctx.userId, action: origin === "human" ? "synergy.shortlist_item_add" : "synergy.shortlist_item_edit", target: `${id}:${area}`, now });
  return ok({ id: curationId, origin }, 201);
});
