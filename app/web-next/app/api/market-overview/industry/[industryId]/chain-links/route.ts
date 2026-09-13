// ADR-0126 — S1 "가치사슬 연계" 승인 엔드포인트. 시장 구조 정의 단계가
// 제안한 인접 산업 링크를 사람이 승인해 structural hop으로 등록한다.
// structural hop은 변환 계수가 없다(DB CHECK 강제) — 위상 기록일 뿐이며,
// 통계 보정(calibrate)을 거쳐야 statistical로 승격된다. 경계 #2: 등록은
// 사람의 행위다.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ industryId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "가치사슬 연계 등록은 analyst 역할 이상이어야 합니다.");
  const { industryId } = await params;
  const db = getDb();

  const industry = db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId) as { id: string } | null;
  if (!industry) return notFound();

  const body = (await request.json().catch(() => null)) as {
    direction?: string; industry_id?: string; evidence_ref?: string;
  } | null;
  const direction = body?.direction;
  if (direction !== "upstream" && direction !== "downstream") {
    return badRequest("invalid_request", "direction은 upstream | downstream 중 하나입니다.");
  }
  const otherId = body?.industry_id?.trim();
  if (!otherId) return badRequest("invalid_request", "industry_id는 필수입니다.");
  const evidenceRef = body?.evidence_ref?.trim();
  if (!evidenceRef) return badRequest("invalid_request", "evidence_ref는 필수입니다 — 무근거 링크는 등록할 수 없습니다.");
  const other = db.query("SELECT id FROM md_industry WHERE id = ?").get(otherId) as { id: string } | null;
  if (!other) return badRequest("invalid_request", "industry_id가 md_industry에 없습니다.");
  if (otherId === industryId) return badRequest("invalid_request", "자기 자신과의 링크는 등록할 수 없습니다.");

  // upstream = 상대가 공급처(상대 → 자산 산업 방향의 공급), downstream = 수요처.
  // proxy_link는 from→to 화살표로 방향을 표현한다.
  const from = direction === "upstream" ? otherId : industryId;
  const to = direction === "upstream" ? industryId : otherId;

  const dup = db
    .query("SELECT id FROM proxy_link WHERE from_industry_id = ? AND to_industry_id = ?")
    .get(from, to) as { id: string } | null;
  if (dup) return badRequest("already_linked", "이미 등록된 링크입니다.");

  const now = new Date().toISOString();
  const id = ulid();
  db.run(
    `INSERT INTO proxy_link (id, from_industry_id, to_industry_id, hop_type, coefficient, beta, r2,
                             lag_months, ci_low, ci_high, evidence_ref, calibrated_at)
     VALUES (?,?,?,'structural',NULL,NULL,NULL,NULL,NULL,NULL,?,NULL)`,
    [id, from, to, evidenceRef],
  );
  appendAudit(db, { actor: ctx.userId, action: "proxy_link_structural_create", target: `${from}->${to}`, now });
  return ok({ id, hop_type: "structural" }, 201);
});
