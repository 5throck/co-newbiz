// ADR-0126 — S1 "가치사슬 연계" 승인 엔드포인트. 시장 구조 정의 단계가
// 제안한 인접 산업 링크를 사람이 승인해 structural hop으로 등록한다.
// structural hop은 변환 계수가 없다(DB CHECK 강제) — 위상 기록일 뿐이며,
// 통계 보정(calibrate)을 거쳐야 statistical로 승격된다. 경계 #2: 등록은
// 사람의 행위다.
//
// ADR-0129 — proxy_link에 relation(전방/전전방/후방/후후방)/hop_distance/
// source/status 컬럼을 추가한다(migration 0093). POST는 이제 relation을
// 요구하고 hop_distance·direction을 서버가 파생한다. source는 기본
// 'user_added'(직접 등록)이며, 호출자가 approved_proposal:true를 보내면
// (LLM 제안을 사람이 승인) 'approved'로 기록한다.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";

type Relation = "전방" | "전전방" | "후방" | "후후방";
const RELATION_TO_HOP_DISTANCE: Record<Relation, 1 | 2> = {
  "전방": 1,
  "전전방": 2,
  "후방": 1,
  "후후방": 2,
};
// 전방/전전방 = 수요처(하류), 후방/후후방 = 공급처(상류) — 기존 direction
// 컬럼과의 하위 호환을 위해 서버가 파생한다.
const RELATION_TO_DIRECTION: Record<Relation, "downstream" | "upstream"> = {
  "전방": "downstream",
  "전전방": "downstream",
  "후방": "upstream",
  "후후방": "upstream",
};

export const POST = route(async (request: Request, { params }: { params: Promise<{ industryId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "가치사슬 연계 등록은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { industryId } = await params;
  const db = getDb();

  const industry = db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId) as { id: string } | null;
  if (!industry) return notFound();

  const body = (await request.json().catch(() => null)) as {
    relation?: string; industry_id?: string; evidence_ref?: string; approved_proposal?: boolean;
  } | null;
  const relation = body?.relation as Relation | undefined;
  if (!relation || !(relation in RELATION_TO_HOP_DISTANCE)) {
    return badRequest("invalid_request", "relation은 전방 | 전전방 | 후방 | 후후방 중 하나입니다.");
  }
  const otherId = body?.industry_id?.trim();
  if (!otherId) return badRequest("invalid_request", "industry_id는 필수입니다.");
  const evidenceRef = body?.evidence_ref?.trim();
  if (!evidenceRef) return badRequest("invalid_request", "evidence_ref는 필수입니다 — 무근거 링크는 등록할 수 없습니다.");
  const other = db.query("SELECT id FROM md_industry WHERE id = ?").get(otherId) as { id: string } | null;
  if (!other) return badRequest("invalid_request", "industry_id가 md_industry에 없습니다.");
  if (otherId === industryId) return badRequest("invalid_request", "자기 자신과의 링크는 등록할 수 없습니다.");

  const direction = RELATION_TO_DIRECTION[relation];
  const hopDistance = RELATION_TO_HOP_DISTANCE[relation];
  // upstream = 상대가 공급처(상대 → 자산 산업 방향의 공급), downstream = 수요처.
  // proxy_link는 from→to 화살표로 방향을 표현한다.
  const from = direction === "upstream" ? otherId : industryId;
  const to = direction === "upstream" ? industryId : otherId;

  // status='active' 조건 필수 — 은퇴된 행은 그 관계 주장이 철회됐다는 뜻일
  // 뿐이므로, 은퇴된 행이 있다는 이유로 (교정된 관계로) 재등록을 막으면 안
  // 된다(2026-09-13 사용자 리포트 — 은퇴 후 재등록이 막혀 있었음).
  const dup = db
    .query("SELECT id FROM proxy_link WHERE from_industry_id = ? AND to_industry_id = ? AND status = 'active'")
    .get(from, to) as { id: string } | null;
  if (dup) return badRequest("already_linked", "이미 등록된 링크입니다.");

  // source: LLM 제안을 사람이 승인한 경로면 'approved', 직접 등록("직접 등록" 폼)이면
  // 기본값 'user_added' — 둘 다 사람의 행위이며, source는 그 경로를 구분하는 기록일 뿐이다.
  const source = body?.approved_proposal === true ? "approved" : "user_added";

  const now = new Date().toISOString();
  const id = ulid();
  db.run(
    `INSERT INTO proxy_link (id, from_industry_id, to_industry_id, hop_type, coefficient, beta, r2,
                             lag_months, ci_low, ci_high, evidence_ref, calibrated_at,
                             relation, hop_distance, source)
     VALUES (?,?,?,'structural',NULL,NULL,NULL,NULL,NULL,NULL,?,NULL,?,?,?)`,
    [id, from, to, evidenceRef, relation, hopDistance, source],
  );
  appendAudit(db, { actor: ctx.userId, action: "proxy_link_structural_create", target: `${from}->${to}`, now });
  return ok({ id, hop_type: "structural", relation, hop_distance: hopDistance, direction, source }, 201);
});
