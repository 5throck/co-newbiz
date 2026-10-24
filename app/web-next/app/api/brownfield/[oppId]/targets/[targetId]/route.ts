// S7 대상 선정 — 후보 수정(PATCH) / 체크리스트 판정 저장(POST).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { screeningSummary, insertTargetEvidence, type TargetRow } from "../../../../../../lib/brownfield-targets.ts";

const now = () => new Date().toISOString();

export async function PATCH(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Candidate updates require the analyst role or higher." });
  if (denied) return denied;
  const { oppId, targetId } = await params;
  const body = (await request.json().catch(() => null)) as
    | { company_name?: string; dart_corp_code?: string | null; universe_note?: string | null }
    | null;
  const db = getDb();
  const existing = db
    .query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, oppId) as { id: string } | undefined;
  if (!existing) return notFound();
  db.run(
    `UPDATE brownfield_target SET
       company_name = COALESCE(?, company_name),
       dart_corp_code = COALESCE(?, dart_corp_code),
       universe_note = COALESCE(?, universe_note),
       updated_at = ? WHERE id = ?`,
    [body?.company_name?.trim() || null, body?.dart_corp_code?.trim() || null, body?.universe_note?.trim() || null, now(), targetId],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "brownfield_target.update", target: `${oppId}:${targetId}`, now: new Date().toISOString() });
  return ok(db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId), 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Screening judgements require the analyst role or higher." });
  if (denied) return denied;
  const { oppId, targetId } = await params;
  const body = (await request.json().catch(() => null)) as
    | {
        states?: Record<string, string>;
        gate_evaluation_id?: string;
        // 위원회 추천 검토가 수집한 항목별 근거 — 사람이 저장으로 확정할 때
        // 함께 보내면 screening_evidence_json(0108)에 보존된다(사용자 결정,
        // 2026-09-16: 수집 정보를 후보 상세에서 나중에 참고할 수 있게).
        evidence?: Record<string, { rationale?: string; source_url?: string | null; kind?: string }>;
      }
    | null;
  const states = body?.states;
  if (!states || typeof states !== "object") return badRequest("invalid_request", "states (checklist judgements) is required.");
  // 판정 척도(사용자 결정, 2026-09-16) — 5단 세분화 + 미판정. 구버전 값
  // (pass/fail/na/waived)은 허용하지 않는다 — 화면이 항상 새 척도로 보낸다.
  const valid = new Set(["confirmed", "probable", "partial", "unfulfilled", "insufficient", "pending"]);
  for (const [k, v] of Object.entries(states)) {
    if (!valid.has(v)) return badRequest("invalid_request", `Invalid judgement for item ${k}: ${v}`);
  }
  const db = getDb();
  const existing = db
    .query("SELECT screening_json, screening_evidence_json FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, oppId) as { screening_json: string | null; screening_evidence_json: string | null } | undefined;
  if (!existing) return notFound();
  const merged = { ...(existing.screening_json ? JSON.parse(existing.screening_json) : {}), ...states };
  // 근거 병합 — 저장된 판정 항목에만 근거를 붙인다(미판정으로 되돌린 항목의
  // 근거는 제거해 판정·근거 정합을 유지).
  let evidenceJson = existing.screening_evidence_json ?? null;
  const incomingEvidence = body?.evidence;
  if (incomingEvidence && typeof incomingEvidence === "object") {
    const prior = existing.screening_evidence_json ? (JSON.parse(existing.screening_evidence_json) as Record<string, unknown>) : {};
    for (const [itemId, meta] of Object.entries(incomingEvidence)) {
      if (states[itemId] === "pending" || !(itemId in states)) continue;
      prior[itemId] = {
        verdict: states[itemId],
        rationale: typeof meta?.rationale === "string" ? meta.rationale.slice(0, 500) : "",
        source_url: typeof meta?.source_url === "string" ? meta.source_url : null,
        kind: meta?.kind === "secured" || meta?.kind === "web" ? meta.kind : "web",
      };
    }
    evidenceJson = JSON.stringify(prior);
  }
  // ADR-0097 back-compat: optional provenance link to the S6/S7 committee
  // deliberation behind this screening judgment (0066 nullable column).
  const gateEvaluationId = body.gate_evaluation_id?.trim() || null;
  if (gateEvaluationId && !db.query("SELECT id FROM gate_evaluation WHERE id = ?").get(gateEvaluationId)) {
    return badRequest("invalid_request", "gate_evaluation_id does not exist — check the gate_evaluation of the committee session.");
  }
  db.run(
    "UPDATE brownfield_target SET screening_json = ?, screening_evidence_json = COALESCE(?, screening_evidence_json), gate_evaluation_id = COALESCE(?, gate_evaluation_id), updated_at = ? WHERE id = ?",
    [JSON.stringify(merged), evidenceJson, gateEvaluationId, now(), targetId],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "brownfield_target.screening", target: `${oppId}:${targetId}`, now: new Date().toISOString() });
  // 근거 타임라인 — 사람이 확정한 판정 기록(0109).
  insertTargetEvidence(db, {
    targetId,
    kind: "screening",
    title: `사전 검토 판정 확정 — ${Object.keys(states).length}건`,
    detail: Object.entries(states).map(([itemId, v]) => `${itemId} ${v}`).join(" · ") || null,
    sourceKind: "manual",
    createdBy: auth.auth.userId,
  });
  const updated = db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId) as unknown as TargetRow;
  // GET .../targets와 동일한 형태(summary가 행에 포함)로 반환한다 — 클라이언트가
  // { ...t, ...target }로 병합할 때 summary가 undefined로 덮여 쓰이지 않도록.
  return ok({ target: { ...updated, screening_summary: screeningSummary(updated) } }, 200);
}
