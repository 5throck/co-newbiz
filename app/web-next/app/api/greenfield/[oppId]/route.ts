// S5 자체 진출 — 기회별 평가 상태 조회/저장.
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../lib/envelope.ts";

const now = () => new Date().toISOString();

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { oppId } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, name FROM opportunity WHERE id = ?").get(oppId) as { id: string; name: string } | null;
  if (!opp) return notFound();
  const assessment = db
    .query("SELECT * FROM greenfield_assessment WHERE opportunity_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(oppId) as Record<string, unknown> | undefined;
  const parse = (v: unknown) => { try { return v ? JSON.parse(v as string) : null; } catch { return null; } };
  return ok({
    opportunity: opp,
    assessment: assessment
      ? { ...assessment, capability_gaps: parse(assessment.capability_gaps_json), business_case_lines: parse(assessment.business_case_lines_json) }
      : null,
  }, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "역량 평가 저장은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { oppId } = await params;
  // ADR-0136: capability_gaps는 더 이상 이 라우트에서 받지 않는다 — 필요 역량은
  // 오직 S3 레지스터(/api/opportunities/[id]/capability-gap)에만 기록된다.
  const body = (await request.json().catch(() => null)) as {
    entry_strategy?: string;
    alternatives_considered?: string;
    business_case_lines?: Array<{ line: string; kind: "cost" | "revenue"; amount: number; note?: string }>;
    rationale?: string;
  } | null;
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId)) return notFound();
  const ts = now();
  const existing = db.query("SELECT id FROM greenfield_assessment WHERE opportunity_id = ? LIMIT 1").get(oppId) as { id: string } | undefined;
  const id = existing?.id ?? ulid();
  if (existing) {
    db.run(
      `UPDATE greenfield_assessment SET
         entry_strategy = COALESCE(?, entry_strategy),
         alternatives_considered = COALESCE(?, alternatives_considered),
         business_case_lines_json = COALESCE(?, business_case_lines_json),
         rationale = COALESCE(?, rationale),
         updated_at = ? WHERE id = ?`,
      [
        body?.entry_strategy?.trim() || null,
        body?.alternatives_considered?.trim() || null,
        body?.business_case_lines ? JSON.stringify(body.business_case_lines) : null,
        body?.rationale?.trim() || null,
        ts, id,
      ],
    );
  } else {
    db.run(
      `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, business_case_lines_json, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id, oppId,
        body?.entry_strategy?.trim() || null,
        body?.alternatives_considered?.trim() || null,
        body?.business_case_lines ? JSON.stringify(body.business_case_lines) : null,
        body?.rationale?.trim() || null,
        ctx.userId, ts, ts,
      ],
    );
  }
  appendAudit(db, { actor: ctx.userId, action: "greenfield_assessment.save", target: `${oppId}:${existing ? "update" : "create"}`, now: ts });
  return ok({ id, updated_at: ts }, 200);
}
