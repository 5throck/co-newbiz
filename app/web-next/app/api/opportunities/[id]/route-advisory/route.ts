// Track advisory (ADR-0104) — deterministic greenfield/brownfield
// recommendation + base rates + re-review triggers for the S4 decision
// surface. Read-only: the human decision is still recorded via the
// route-decision POST (boundary #2).
// flow.spec v2.4.0 — the response also carries `s1Evidence` (market size,
// CAGR, competitive structure, capability-gap summary) so the S4 screen can
// render the market/competitive/capability grounding inline from the same
// source the advisory signals read.
import { authenticate } from "../../../../../lib/auth.ts";
import { computeTrackAdvisory } from "../../../../../lib/track-advisory.ts";
import { parseGapRegister, summarizeGap, type CapabilityGapRow } from "../../../../../lib/capability-gap.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, market_scope, capability_gap_json FROM opportunity WHERE id = ?").get(id) as
    | { id: string; market_scope: string | null; capability_gap_json: string | null }
    | undefined;
  if (!opp) return notFound();
  const advisory = computeTrackAdvisory(db, id);

  // S1 근거 — 기회 산업의 최신 완료 시장분석 버전 (route-recommendation·
  // gate-brief·opportunity-factors와 동일한 조회 관용법).
  const ind = opp.market_scope
    ? db.query("SELECT id, name_ko FROM md_industry WHERE name_ko = ? LIMIT 1").get(opp.market_scope) as { id: string; name_ko: string } | undefined
    : undefined;
  const version = ind
    ? db.query(
        `SELECT v.version_no, v.payload FROM market_sizing_version v
         JOIN market_sizing_analysis a ON a.id = v.analysis_id
         WHERE a.industry_id = ? AND a.status = 'completed'
         ORDER BY v.version_no DESC LIMIT 1`,
      ).get(ind.id) as { version_no: number; payload: string } | undefined
    : undefined;
  let s1Evidence: {
    industryName: string; versionNo: number | null;
    marketSizeUsdB: number | null; cagr: number | null;
    competitive: { structure: string; players: Array<{ name: string; tier: string; note: string }> } | null;
  } | null = null;
  if (version) {
    try {
      const m = (JSON.parse(version.payload) as {
        matrix?: {
          anchor?: { total?: number };
          consistency?: { bottomUpCagr?: number };
          competitive?: { structure?: string; players?: Array<{ name?: string; tier?: string; note?: string }> };
        };
      }).matrix ?? {};
      const players = (m.competitive?.players ?? []).map((p) => ({
        name: String(p?.name ?? "").trim(),
        tier: String(p?.tier ?? "niche"),
        note: String(p?.note ?? "").trim(),
      })).filter((p) => p.name).slice(0, 12);
      s1Evidence = {
        industryName: ind!.name_ko,
        versionNo: version.version_no,
        marketSizeUsdB: m.anchor?.total ?? null,
        cagr: m.consistency?.bottomUpCagr ?? null,
        competitive: m.competitive?.structure ? { structure: m.competitive.structure, players } : null,
      };
    } catch { /* malformed payload — no evidence */ }
  }

  const gapReg = parseGapRegister(opp.capability_gap_json);
  const gapSummary = { rows: gapReg.rows, ...summarizeGap(gapReg.rows) };
  const capabilityGap = gapReg.rows.length > 0
    ? {
        total: gapSummary.total,
        evaluated: gapSummary.evaluated,
        met: gapSummary.met,
        partial: gapSummary.partial,
        unmet: gapSummary.unmet,
        coveragePct: gapSummary.coveragePct,
        unmetRows: gapReg.rows
          .filter((r: CapabilityGapRow) => r.held.status === "unmet")
          .map((r) => ({ capability: r.capability, resolution: r.resolution })),
        // S4 평가 근거 탭 (2026-09-15 사용자 요구) — S3에서 확정한 필요 역량
        // 수준 전체 행을 그대로 노출해 역량 관련 5기준(역량 결정성·통합
        // 역량·역량확보 속도) 채점의 근거로 쓰게 한다.
        rows: gapReg.rows.map((r: CapabilityGapRow) => ({
          capability: r.capability,
          source: r.source,
          held: { status: r.held.status, holders: r.held.holders, evidence: r.held.evidence },
          resolution: r.resolution,
        })),
      }
    : null;

  return ok({ ...advisory, s1Evidence, capabilityGap }, 200);
});
