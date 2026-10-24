// 드라이버 impact 조합의 역산 feasibility 스윕 + CAGR 밴드 몬테카를로
// (design 2026-09-19-sim-engine-runtime-separation §2·§4). POST = 스윕 실행·
// 저장(analyst+), GET = 최신 결과 조회.
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { appendExternalReference, resolveExternalReference } from "../../../../../../lib/market-calibration.ts";
import { latestSweep, runCalibrationSweep } from "../../../../../../lib/calibration-sweep.ts";

export async function GET(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { industryId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) return notFound();
  return ok({ latest: latestSweep(db, industryId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Sweep execution requires the analyst role or higher." });
  if (denied) return denied;
  const { industryId } = await params;
  const body = (await request.json().catch(() => null)) as { samples?: number; seed?: number } | null;
  const db = getDb();
  if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) return notFound();

  const reference = resolveExternalReference(db, industryId);
  if (!reference) {
    return badRequest("reference_required", "No external reference recorded — record the reference with its source first.");
  }
  // 최신 완료 payload의 바텀업 CAGR·앵커·셀 구조를 읽는다.
  const analysis = db
    .query("SELECT id FROM market_sizing_analysis WHERE industry_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1")
    .get(industryId) as { id: string } | undefined;
  if (!analysis) return badRequest("analysis_required", "No completed market analysis — run the S1 analysis first.");
  const version = db
    .query("SELECT payload FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1")
    .get(analysis.id) as { payload: string } | undefined;
  if (!version) return badRequest("version_required", "No completed version exists.");
  const matrix = (JSON.parse(version.payload) as { matrix?: { consistency?: { bottomUpCagr?: number }; anchor?: { total?: number }; segments?: Array<{ code: string; label: string }>; baseline2026?: Record<string, Record<string, number>>; cagrBase?: Record<string, Record<string, number>>; bandOverrides?: Record<string, { down: number; up: number }> } }).matrix ?? {};
  const bottomUp = matrix.consistency?.bottomUpCagr;
  if (typeof bottomUp !== "number") return badRequest("cagr_missing", "The latest version has no bottomUpCagr — a re-analysis is needed.");
  const anchorTotal = matrix.anchor?.total;
  const baseline = matrix.baseline2026;
  const cagrBase = matrix.cagrBase;
  const segments = matrix.segments ?? [];
  if (!anchorTotal || !baseline || !cagrBase || !segments.length) {
    return badRequest("matrix_incomplete", "The latest version matrix has no anchor/cell data.");
  }
  const cells = segments.flatMap((seg) =>
    Object.keys(baseline).map((region) => ({
      base2026: (baseline[region]?.[seg.code] ?? 0),
      downCagr: (cagrBase[region]?.[seg.code] ?? 0.05) * 0.5,
      baseCagr: (cagrBase[region]?.[seg.code] ?? 0.05),
      upCagr: (matrix.bandOverrides?.[`${region}|${seg.code}`]?.up ?? (cagrBase[region]?.[seg.code] ?? 0.05) * 1.55),
    })),
  );
  const accepted = db
    .query("SELECT driver, direction, impact_pct FROM industry_driver_calibration WHERE industry_id = ? AND status = 'accepted' ORDER BY impact_pct DESC")
    .all(industryId) as Array<{ driver: string; direction: "upside" | "downside"; impact_pct: number }>;
  const view = runCalibrationSweep(db, {
    industryId,
    ourCagrPct: bottomUp,
    externalCagrPct: reference.external_cagr_pct,
    externalSourceLabel: reference.source_label,
    drivers: accepted.map((d) => ({ driver: d.driver, direction: d.direction, impact_pct: d.impact_pct })),
    sampleCount: typeof body?.samples === "number" ? body.samples : undefined,
    seed: typeof body?.seed === "number" ? body.seed : undefined,
    createdBy: auth.auth.userId,
  });
  const band = (function bandMc() {
    const { bandMonteCarlo } = require("../../../../../../lib/calibration-sweep.ts") as typeof import("../../../../../../lib/calibration-sweep.ts");
    return bandMonteCarlo({ cells, targetYear: reference.target_year, seed: view.seed });
  })();
  return ok({ ...view, band, external_reference: reference }, 200);
}
