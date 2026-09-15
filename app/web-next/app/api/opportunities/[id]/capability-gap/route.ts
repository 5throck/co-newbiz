// S3 역량 갭 분석 (flow.spec v2.4.0) — opportunity.capability_gap_json
// (마이그레이션 0098) 조회·저장. GET은 미저장 시 S2 스케치의
// requiredCapabilities(v1 레거시 필드)로 시드 초안을 in-memory로 제공하고,
// 저장(PUT)은 사람의 행위다. 보유 판정 근거는 그룹/계열사 프로필뿐 — 내부
// (자사 단독) 역량 평가는 후속 보강 사항이다.
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { normalizeGapRows, parseGapRegister, type CapabilityGapRow } from "../../../../../lib/capability-gap.ts";

const now = () => new Date().toISOString();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const opp = db
    .query("SELECT id, name, capability_gap_json, sketch_json FROM opportunity WHERE id = ?")
    .get(id) as { id: string; name: string; capability_gap_json: string | null; sketch_json: string | null } | undefined;
  if (!opp) return notFound();

  const stored = parseGapRegister(opp.capability_gap_json);
  let sketchCapabilities: string[] = [];
  if (opp.sketch_json) {
    try {
      const raw = JSON.parse(opp.sketch_json) as { requiredCapabilities?: unknown };
      sketchCapabilities = Array.isArray(raw.requiredCapabilities)
        ? raw.requiredCapabilities.map((x) => String(x ?? "").trim().slice(0, 200)).filter(Boolean).slice(0, 20)
        : [];
    } catch { /* malformed sketch — no seed */ }
  }

  // 미저장 상태면 스케치 역량을 미판정 행으로 시드한 초안을 함께 제공한다 —
  // 저장 전까지는 DB에 기록되지 않는다(in-memory 시드).
  const storedCapabilities = new Set(stored.rows.map((r) => r.capability));
  const seeded: CapabilityGapRow[] = sketchCapabilities
    .filter((c) => !storedCapabilities.has(c))
    .map((c) => ({
      id: ulid(),
      capability: c,
      source: "s2_sketch" as const,
      requiredNote: "S2 비즈니스 모델 스케치 requiredCapabilities에서 도출",
      held: { status: "unevaluated" as const, holders: [], evidence: "" },
      resolution: null,
      note: "",
      requiredLevel: "",
      currentLevel: "",
    }));

  return ok({
    opportunity: { id: opp.id, name: opp.name },
    rows: [...stored.rows, ...seeded],
    stored: opp.capability_gap_json !== null,
    sketchCapabilities,
    // 보유 판정 근거 한계 — 모든 소비 표면(기회 상세·S4·게이트 브리프)이 동일 문구를 쓴다.
    internalAssessmentPending: true,
    internalAssessmentNote: "내부(자사 단독) 역량 평가는 추후 보강 예정 — 현재 보유 판정 근거는 그룹/계열사 프로필 기준입니다.",
  }, 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "필요 역량 수준 레지스터 저장은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  if (!body || !Array.isArray(body.rows)) return badRequest("invalid_request", "rows(필요 역량 수준 행 배열)는 필수입니다.");
  const rows = normalizeGapRows(body.rows);
  if (rows.length === 0) return badRequest("invalid_request", "저장할 유효한 행이 없습니다 — capability는 필수입니다.");
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  const at = now();
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [JSON.stringify({ rows, updatedAt: at }), id]);
  appendAudit(db, { actor: auth.auth.userId, action: "capability_gap.save", target: `${id}:${rows.length}rows`, now: at });
  // GET과 동일한 소비 형태로 반환한다 — 클라이언트가 저장 직후 상태를 그대로 반영.
  return ok({
    rows,
    updatedAt: at,
    stored: true,
    internalAssessmentPending: true,
    internalAssessmentNote: "내부(자사 단독) 역량 평가는 추후 보강 예정 — 현재 보유 판정 근거는 그룹/계열사 프로필 기준입니다.",
  }, 200);
}
