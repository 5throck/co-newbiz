// S11 설립 실행 기록 (entity-establishment-execution 절차, ADR-0085).
// origin∈{internal,joint} 프로젝트의 설립 5단계 상태·증적을 기록한다 —
// flow.spec S11 completionCriteria("origin∈{internal,joint}인 프로젝트는
// entity-establishment-execution 5단계 완료 기록이 존재한다")의 데이터 근거.
// 상태는 절차 kill criteria 액션과 1:1 (halted / escalated 포함).
import { getDb } from "../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, humanOnlyDenied, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { route } from "../../../../../lib/route.ts";

const STATUSES = ["pending", "in_progress", "done", "halted", "escalated"] as const;
const ORIGINS = ["internal", "joint"] as const;
const STEP_TITLES: Record<number, string> = {
  1: "설립준비(관할·주식구조·이사회 결의)",
  2: "법인등기·정관·사업자등록",
  3: "인허가 이전/재발급 분류",
  4: "인력이전(신 근로계약+PIIA)",
  5: "완료확인(IP양도체인·거버넌스 베이스라인)",
};

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, name, status FROM opportunity WHERE id = ?").get(id) as
    | { id: string; name: string; status: string }
    | null;
  if (!opp) return notFound();
  const steps = db
    .query(
      `SELECT step_no, status, origin, checklist_item, evidence_url, note, owner, updated_at
       FROM entity_establishment_step WHERE opportunity_id = ? ORDER BY step_no`,
    )
    .all(id) as Array<Record<string, unknown>>;
  const doneCount = steps.filter((s) => s.status === "done").length;
  return ok(
    {
      opportunity: opp,
      steps,
      complete: doneCount === 5 && steps.every((s) => s.status === "done"),
      progress: `${doneCount}/5`,
    },
    200,
    { count: steps.length },
  );
});

export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "설립 실행 기록 갱신은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    step_no?: number; status?: string; origin?: string;
    checklist_item?: string; evidence_url?: string; note?: string;
  } | null;
  // ADR-0165 addendum: completing a step is human-only (boundary #2), enforced
  // here as well as at the MCP in-process port.
  if (body?.status === "done") {
    const denied = humanOnlyDenied(ctx, "설립 실행 단계 완료 처리는 사람만 할 수 있습니다 (boundary #2).");
    if (denied) return denied;
  }
  const stepNo = Number(body?.step_no);
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 5) return badRequest("invalid_request", "step_no는 1–5 사이 정수입니다.");
  const status = body?.status;
  if (!status || !STATUSES.includes(status as typeof STATUSES[number])) {
    return badRequest("invalid_request", `status는 ${STATUSES.join(" | ")} 중 하나입니다.`);
  }
  const origin = body?.origin;
  if (!origin || !ORIGINS.includes(origin as typeof ORIGINS[number])) {
    return badRequest("invalid_request", "origin은 internal | joint 중 하나입니다 (ADR-0047).");
  }

  const db = getDb();
  const opp = db.query("SELECT id, status FROM opportunity WHERE id = ?").get(id) as
    | { id: string; status: string }
    | null;
  if (!opp) return notFound();

  // 순서 강제 — 완료확인(5)은 선행 4단계가 모두 done일 때만 완료할 수 있다.
  if (stepNo === 5 && status === "done") {
    const prior = db
      .query(
        `SELECT COUNT(*) AS c FROM entity_establishment_step
         WHERE opportunity_id = ? AND step_no < 5 AND status = 'done'`,
      )
      .get(id) as { c: number };
    if (prior.c < 4) return badRequest("invalid_request", "완료확인(5단계)은 선행 4단계가 모두 완료된 후에만 완료할 수 있습니다.");
  }

  const now = new Date().toISOString();
  const existing = db
    .query("SELECT id, status FROM entity_establishment_step WHERE opportunity_id = ? AND step_no = ? AND checklist_item IS ?")
    .get(id, stepNo, body?.checklist_item?.trim() || null) as { id: string; status: string } | undefined;
  // ADR-0165: a done step is immutable through this legacy projection; the
  // reopen action exists on the project route only.
  if (existing?.status === "done") return fail(409, "reopen_required", "완료된 단계는 먼저 재개해야 변경할 수 있습니다.");
  let rowId: string;
  if (existing) {
    rowId = existing.id;
    db.run(
      `UPDATE entity_establishment_step
       SET status = ?, evidence_url = ?, note = ?, owner = ?, updated_at = ?
       WHERE id = ?`,
      [status, body?.evidence_url?.trim() || null, body?.note?.trim() || null, ctx.userId, now, rowId],
    );
  } else {
    rowId = ulid();
    db.run(
      `INSERT INTO entity_establishment_step
         (id, opportunity_id, step_no, status, origin, checklist_item, evidence_url, note, owner, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [rowId, id, stepNo, status, origin, body?.checklist_item?.trim() || null,
       body?.evidence_url?.trim() || null, body?.note?.trim() || null, ctx.userId, now],
    );
  }
  appendAudit(db, { actor: ctx.userId, action: "entity_establishment.update", target: id, now });

  const doneCount = (db.query(
    "SELECT COUNT(*) AS c FROM entity_establishment_step WHERE opportunity_id = ? AND step_no = ? AND status = 'done'",
  ).get(id, stepNo) as { c: number }).c;
  return ok({
    id: rowId, step_no: stepNo, status, title: STEP_TITLES[stepNo],
    step_done: doneCount > 0, updated_at: now,
  }, 200);
});
