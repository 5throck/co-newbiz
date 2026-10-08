// S1 competitive-structure input (Wave C-3, pilot-009 D-6).
// Records the concentration summary and major players for a completed
// analysis as a NEW version whose matrix.competitive is the human-entered
// value — the exact place the S1 predicate reads (process-flow.ts S1). Without
// this a disclosed market structure could only come from an LLM re-analysis,
// so S1 could never complete offline. The previous matrix is carried over
// untouched; the data-confidence grade is re-derived from the same inputs.
import { getDb } from "../../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { deriveDataConfidence } from "../../../../../../../../db/lib/data-confidence.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import type { CompetitiveStructure, SizingMatrix } from "../../../../../../lib/market-sizing.ts";

const TIERS = new Set(["leader", "challenger", "niche"]);

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "경쟁 구조 입력은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    structure?: string;
    players?: Array<{ name?: string; tier?: string; note?: string; share_pct?: number; evidence_ref?: string }>;
  } | null;
  const structure = body?.structure?.trim();
  if (!structure) return badRequest("invalid_request", "structure(집중도 요약)가 필요합니다.");
  if (!Array.isArray(body?.players) || body.players.length === 0) {
    return badRequest("invalid_request", "players(주요 플레이어) 1건 이상이 필요합니다.");
  }
  const players: CompetitiveStructure["players"] = [];
  for (const p of body.players) {
    const name = p.name?.trim();
    if (!name) return badRequest("invalid_request", "각 player에는 name이 필요합니다.");
    if (p.tier !== undefined && !TIERS.has(p.tier)) return badRequest("invalid_request", `tier must be one of ${[...TIERS].join("|")}.`);
    if (p.share_pct !== undefined && (typeof p.share_pct !== "number" || p.share_pct < 0 || p.share_pct > 100)) {
      return badRequest("invalid_request", "share_pct must be a number between 0 and 100.");
    }
    const share = p.share_pct !== undefined ? `점유율 ${p.share_pct}%` : "";
    const note = [p.note?.trim(), share].filter(Boolean).join(" · ") || "분석가 입력";
    players.push({
      name,
      tier: (p.tier as "leader" | "challenger" | "niche" | undefined) ?? "challenger",
      note,
      evidenceRef: p.evidence_ref?.trim() || undefined,
      attributes: p.share_pct !== undefined ? [{ label: "점유율(%)", value: String(p.share_pct) }] : undefined,
    });
  }

  const db = getDb();
  const analysis = db.query("SELECT id, industry_id, status FROM market_sizing_analysis WHERE id = ?").get(id) as
    | { id: string; industry_id: string; status: string } | null;
  if (!analysis) return notFound();
  const latest = db
    .query("SELECT version_no, payload FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1")
    .get(id) as { version_no: number; payload: string } | null;
  if (!latest) return badRequest("no_version", "완료된 분석 버전이 없습니다 — 먼저 산업 시장분석을 실행하세요.");
  let parsed: { methodology?: string; matrix?: SizingMatrix; stepSummaries?: unknown[] };
  try { parsed = JSON.parse(latest.payload); } catch { return badRequest("invalid_payload", "최신 버전 payload를 읽을 수 없습니다."); }
  if (!parsed.matrix) return badRequest("invalid_payload", "최신 버전에 매트릭스가 없습니다.");

  const matrix: SizingMatrix = { ...parsed.matrix, competitive: { structure, players } };
  const now = new Date().toISOString();
  const nextVersionNo = latest.version_no + 1;
  const versionId = ulid();
  const confidence = deriveDataConfidence(db, analysis.industry_id, matrix.provenance, { synthesized: matrix.synthesized === true });
  db.transaction(() => {
    db.run(
      `INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, changelog, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [versionId, id, nextVersionNo, JSON.stringify({ ...parsed, matrix }), `v${nextVersionNo} — 경쟁 구조 수동 입력(집중도 요약·주요 플레이어)`, ctx.userId, now, confidence.grade, confidence.chainHops, confidence.basis],
    );
  })();
  appendAudit(db, { actor: ctx.userId, action: "market_sizing_analysis.competitive_input", target: `${id}:v${nextVersionNo}`, now });
  return ok({ analysis_id: id, version_no: nextVersionNo, version_id: versionId }, 201);
}
