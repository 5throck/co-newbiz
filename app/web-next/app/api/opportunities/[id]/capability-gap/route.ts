// S3 역량 갭 분석 (flow.spec v2.4.0) — opportunity.capability_gap_json
// (마이그레이션 0098) 조회·저장. GET은 미저장 시 S2 스케치의
// requiredCapabilities(v1 레거시 필드)로 시드 초안을 in-memory로 제공하고,
// 저장(PUT)은 사람의 행위다. 보유 판정 근거는 그룹/계열사 프로필뿐 — 내부
// (자사 단독) 역량 평가는 후속 보강 사항이다.
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { persistGapRegister } from "../../../../../lib/capability-register-write.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { carryOverAttainability, normalizeGapRows, parseGapRegister, preserveStoredOwnedFields, type CapabilityGapRow } from "../../../../../lib/capability-gap.ts";

const now = () => new Date().toISOString();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
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
      necessity: "" as const,
      necessityScopeNote: "",
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
  { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "필요 역량 수준 레지스터 저장은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  if (!body || !Array.isArray(body.rows)) return badRequest("invalid_request", "rows(필요 역량 수준 행 배열)는 필수입니다.");
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  // S8 판정(attainability, ADR-0168)은 저장돼 있던 값을 id로 이어 붙인다 — 클라이언트가
  // 보낸 판정·확정 필드는 신뢰하지 않는다(확정은 사람 전용 경로).
  // ADR-0172 amendment 2026-10-14 (2): resolution (S5-owned) and legacy held.holders are merged from the
  // CURRENT row by id inside the same transaction when the client omits them, so an S3 save can never
  // wipe S5's 해소 방식. S8 판정(attainability, ADR-0168)도 저장된 값을 id로 이어 붙인다 — 클라이언트가
  // 보낸 판정·확정 필드는 신뢰하지 않는다(확정은 사람 전용 경로).
  // ADR-0170: S3 changes invalidate the S8 judgements of changed rows (history, not deletion);
  // rows deleted here are archived. Events are audited under the calling user.
  const at = now();
  const rows = db.transaction(() => {
    const storedJson = (db.query("SELECT capability_gap_json AS j FROM opportunity WHERE id = ?").get(id) as { j: string | null }).j;
    const carried = carryOverAttainability(normalizeGapRows(preserveStoredOwnedFields(body.rows as unknown[], parseGapRegister(storedJson).rows)), storedJson);
    if (carried.length === 0) return null;
    const written = persistGapRegister(db, id, carried, at, auth.auth.userId);
    appendAudit(db, { actor: auth.auth.userId, action: "capability_gap.save", target: `${id}:${written.rows.length}rows`, now: at });
    return written.rows;
  })();
  if (!rows) return badRequest("invalid_request", "저장할 유효한 행이 없습니다 — capability는 필수입니다.");
  // GET과 동일한 소비 형태로 반환한다 — 클라이언트가 저장 직후 상태를 그대로 반영.
  return ok({
    rows,
    updatedAt: at,
    stored: true,
    internalAssessmentPending: true,
    internalAssessmentNote: "내부(자사 단독) 역량 평가는 추후 보강 예정 — 현재 보유 판정 근거는 그룹/계열사 프로필 기준입니다.",
  }, 200);
}
