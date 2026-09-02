// S4 진출방식 결정 (route decision) — selected 기회에 대한 트랙(GF/BF) +
// 라우트 유형 기록. flow.spec v2.0.0: Greenfield(S5 역량 평가) / Brownfield(S6 대상
// 후보 발굴)의 분기점. S4 완료 산출물 "트랙 결정(GF/BF)·근거" + "5criteria 채점 결과".
// 채점 프레임워크: 2026-08-24 Class-C 결정 (d) / ADR-0052 — Stage 1 의도 분기
// (integration | capability_access) → Stage 2 5기준 × 20% × 1–3점 + 사전배제.
import { getDb } from "../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";

const TRACKS = ["greenfield", "brownfield"] as const;
const GF_SUB = ["existing_business_rbd", "intra_venture"] as const;
const BF_SUB = ["m_and_a", "jv", "strategic_investment", "minority_investment", "partnership", "rbd", "corporate_venture"] as const;
const INTENTS = ["integration", "capability_access"] as const;
// 통제 필요도=高 + 역량접근 의도에서 license/co-dev 성 라우트는 사전배제된다
// (합산 점수와 무관하게 — lexicographic override, Class-C 결정 (d)).
const OVERRIDDEN_SUBS = ["partnership", "rbd", "corporate_venture"] as const;
const CRITERIA = ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"] as const;

interface ScoreInput { criterion: string; score: number; evidence_note: string }

function validateScores(raw: unknown): { scores: ScoreInput[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "scores는 5기준 배열입니다." };
  const seen = new Map<string, ScoreInput>();
  for (const item of raw as Array<Record<string, unknown>>) {
    const criterion = String(item?.criterion ?? "");
    if (!CRITERIA.includes(criterion as typeof CRITERIA[number])) return { error: `알 수 없는 채점 기준: ${criterion}` };
    if (seen.has(criterion)) return { error: `중복 기준: ${criterion}` };
    const score = Number(item?.score);
    if (!Number.isInteger(score) || score < 1 || score > 3) return { error: `${criterion} 점수는 1–3 사이 정수입니다.` };
    const note = String(item?.evidence_note ?? "").trim();
    if (!note) return { error: `${criterion} 근거(evidence_note)는 필수입니다.` };
    seen.set(criterion, { criterion, score, evidence_note: note });
  }
  if (seen.size !== CRITERIA.length) {
    const missing = [...CRITERIA].filter((c) => !seen.has(c));
    return { error: `5기준 전체 채점이 필요합니다 — 누락: ${missing.join(", ")}` };
  }
  return { scores: [...seen.values()] };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, name, status FROM opportunity WHERE id = ?").get(id) as
    | { id: string; name: string; status: string }
    | null;
  if (!opp) return notFound();
  const decisions = db
    .query(
      `SELECT id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at,
              intent, override_flagged, staging_recommended, total_score
       FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC`,
    )
    .all(id) as Array<Record<string, unknown> & { id: string }>;
  const scores = db
    .query(
      `SELECT s.decision_id, s.intent, s.criterion, s.score, s.evidence_note
       FROM route_decision_score s
       JOIN route_decision d ON d.id = s.decision_id
       WHERE d.opportunity_id = ? ORDER BY s.created_at`,
    )
    .all(id) as Array<Record<string, unknown>>;
  for (const d of decisions) {
    d.scores = scores.filter((s) => s.decision_id === d.id).map(({ decision_id: _drop, ...rest }) => rest);
  }
  return ok({ opportunity: opp, decisions }, 200, { count: decisions.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "진출방식 결정은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    track?: string; sub_track?: string; rationale?: string; alternatives_considered?: string;
    intent?: string; scores?: unknown;
  } | null;
  const track = body?.track;
  const rationale = body?.rationale?.trim();
  if (!track || !TRACKS.includes(track as typeof TRACKS[number])) return badRequest("invalid_request", "track은 greenfield | brownfield 중 하나입니다.");
  if (!rationale) return badRequest("invalid_request", "rationale(근거)은 필수입니다.");
  const subTrack = body?.sub_track?.trim() || null;
  if (track === "greenfield" && subTrack && ![...GF_SUB].includes(subTrack as typeof GF_SUB[number])) {
    return badRequest("invalid_request", "greenfield sub_track은 existing_business_rbd | intra_venture 중 하나입니다.");
  }
  if (track === "brownfield" && subTrack && !BF_SUB.includes(subTrack as typeof BF_SUB[number])) {
    return badRequest("invalid_request", "brownfield sub_track은 m_and_a | jv | strategic_investment | minority_investment | partnership | rbd | corporate_venture 중 하나입니다.");
  }

  // 채점 — Brownfield는 스펙 completionCriteria상 5criteria + 사전배제 점검이 의무.
  const intent = body?.intent;
  let intentValue: string | null = null;
  if (intent) {
    if (!INTENTS.includes(intent as typeof INTENTS[number])) {
      return badRequest("invalid_request", "intent는 integration | capability_access 중 하나입니다.");
    }
    intentValue = intent;
  }
  let scoreRows: ScoreInput[] = [];
  if (track === "brownfield") {
    if (!intentValue) return badRequest("invalid_request", "Brownfield 결정에는 intent(Stage 1 의도 분기)가 필수입니다.");
    const result = validateScores(body?.scores);
    if ("error" in result) return badRequest("invalid_request", result.error);
    scoreRows = result.scores;
    // 사전배제 — 통제 필요도=高 + 역량접근 의도 + 라이선스/공동개발 성 라우트
    const controlNeed = scoreRows.find((s) => s.criterion === "control_need")!.score;
    if (intentValue === "capability_access" && controlNeed === 3 && subTrack && OVERRIDDEN_SUBS.includes(subTrack as typeof OVERRIDDEN_SUBS[number])) {
      return badRequest(
        "invalid_request",
        "사전배제: 통제 필요도가 高이고 파트너 지식이 암묵적인 역량접근 의도에서 라이선스·공동개발 성 라우트(partnership/rbd/corporate_venture)는 배제됩니다. 라우트를 변경하거나 채점을 재검토하세요.",
      );
    }
  }

  const db = getDb();
  const opp = db.query("SELECT id, status FROM opportunity WHERE id = ?").get(id) as
    | { id: string; status: string }
    | null;
  if (!opp) return notFound();
  if (opp.status !== "selected") return badRequest("invalid_request", "선별(selected)된 기회만 진출방식을 결정할 수 있습니다.");

  // 합산 점수(각 20%, 만점 3.0)와 기본 스테이징 권고는 서버가 계산한다.
  const total = scoreRows.length === CRITERIA.length
    ? Math.round(scoreRows.reduce((sum, s) => sum + s.score * 0.2, 0) * 100) / 100
    : null;
  const uncertainty = scoreRows.find((s) => s.criterion === "market_uncertainty")?.score ?? null;
  const controlNeed = scoreRows.find((s) => s.criterion === "control_need")?.score ?? null;
  let stagingRecommended: string | null = null;
  if (uncertainty === 3 && controlNeed !== null && controlNeed <= 2) {
    stagingRecommended = "소수지분/공동개발 + 사전 협약된 step-up(call option / ROFR / 전환 트리거 — 다음 게이트에서 행사) 권고";
  }

  const decisionId = ulid();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at,
                                 intent, override_flagged, staging_recommended, total_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [decisionId, id, track, subTrack, rationale, body?.alternatives_considered?.trim() || null, ctx.userId, now,
     intentValue, 0, stagingRecommended, total],
  );
  for (const s of scoreRows) {
    db.run(
      `INSERT INTO route_decision_score (id, decision_id, intent, criterion, score, evidence_note, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [ulid(), decisionId, intentValue!, s.criterion, s.score, s.evidence_note, now],
    );
  }
  appendAudit(db, { actor: ctx.userId, action: "route_decision.create", target: id, now });

  return ok({
    id: decisionId, track, sub_track: subTrack, rationale, decided_at: now,
    intent: intentValue, total_score: total, staging_recommended: stagingRecommended,
  }, 201);
}
