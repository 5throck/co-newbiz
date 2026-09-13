// Industry detail — value chain, driver sensitivities, and regional data
// for one industry (S1 drill-down). Aggregates from chain_node_sensitivity,
// structure_simulation_result, and md_industry.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { fail, forbidden, notFound, ok, badRequest } from "../../../../../lib/envelope.ts";
import { parseKsicInput } from "../../../../../lib/ksic.ts";

export async function GET(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { industryId } = await params;
  const db = getDb();

  const industry = db
    .query("SELECT id, name_ko, name_en, ksic_code, naics_code FROM md_industry WHERE id = ?")
    .get(industryId) as
    | { id: string; name_ko: string; name_en: string | null; ksic_code: string | null; naics_code: string | null }
    | null;
  if (!industry) return notFound();

  // Driver sensitivities grouped by driver + region
  const driverSensitivities = db
    .query(
      `SELECT cs.driver_id, d.label_ko AS driver_label, cs.sensitivity, cs.lag_months,
              cs.region_code, cs.segment_code, cs.evidence_ref
       FROM chain_node_sensitivity cs
       JOIN industry_driver d ON d.id = cs.driver_id
       WHERE cs.industry_id = ?
       ORDER BY cs.driver_id, cs.region_code`,
    )
    .all(industryId) as Array<{
    driver_id: string; driver_label: string; sensitivity: number;
    lag_months: number | null; region_code: string | null; segment_code: string | null; evidence_ref: string | null;
  }>;

  // 신규 산업(검토/안건 미연계)은 chain_node_sensitivity rows가 없다 — 우선 ADR-0129
  // 큐레이션된 수요산업(전방/전전방)의 CAGR에서 민감도를 파생하고, 아직 큐레이션이
  // 없는 산업은 기존 자기 매트릭스 세그먼트×CAGR 파생(폴백의 폴백)으로 같은 화면을 제공한다.
  // (민감도 = CAGR × 10, 시드 스크립트와 동일한 placeholder 척도)
  if (driverSensitivities.length === 0) {
    type SizingMatrixShape = {
      segments?: Array<{ code: string; label: string }>;
      regions?: Array<{ code: string; label: string }>;
      baseline2026?: Record<string, Record<string, number>>;
      cagrBase?: Record<string, Record<string, number>>;
    };
    const weightedCagr = (matrix: SizingMatrixShape | undefined): number => {
      const segs = matrix?.segments ?? [];
      const regions = matrix?.regions ?? [];
      let wSum = 0;
      let cagrSum = 0;
      for (const seg of segs) {
        for (const r of regions) {
          const base = matrix?.cagrBase?.[r.code]?.[seg.code] ?? 0;
          const w = matrix?.baseline2026?.[r.code]?.[seg.code] ?? 0;
          cagrSum += base * w;
          wSum += w;
        }
      }
      return wSum > 0 ? cagrSum / wSum : 0;
    };

    // 1) ADR-0129 큐레이션된 수요산업(전방/전전방) 기반 파생.
    const demandIndustries = db
      .query(
        `SELECT p.relation, p.hop_distance,
                CASE WHEN p.from_industry_id = ? THEN p.to_industry_id ELSE p.from_industry_id END AS related_industry_id
         FROM proxy_link p
         WHERE (p.from_industry_id = ? OR p.to_industry_id = ?)
           AND p.status = 'active' AND p.relation IN ('전방','전전방')`,
      )
      .all(industryId, industryId, industryId) as Array<{
      relation: string; hop_distance: number | null; related_industry_id: string;
    }>;

    for (const d of demandIndustries) {
      const relatedIndustry = db
        .query("SELECT id, name_ko FROM md_industry WHERE id = ?")
        .get(d.related_industry_id) as { id: string; name_ko: string } | null;
      if (!relatedIndustry) continue;
      const relatedLatest = db
        .query(
          `SELECT v.payload FROM market_sizing_version v
           JOIN market_sizing_analysis a ON a.id = v.analysis_id
           WHERE a.industry_id = ? AND a.status = 'completed'
           ORDER BY v.version_no DESC LIMIT 1`,
        )
        .get(relatedIndustry.id) as { payload: string } | null;
      if (!relatedLatest) continue;
      try {
        const matrix = (JSON.parse(relatedLatest.payload) as { matrix?: SizingMatrixShape }).matrix;
        const wCagr = weightedCagr(matrix);
        driverSensitivities.push({
          driver_id: `demand-${relatedIndustry.id}`,
          driver_label: `수요산업: ${relatedIndustry.name_ko}`,
          sensitivity: Math.round(wCagr * 10 * 100) / 100,
          lag_months: 0,
          region_code: null,
          segment_code: null,
          evidence_ref: `proxy_link 전방/전전방 큐레이션 — ${d.relation} ${relatedIndustry.name_ko}`,
        });
      } catch {
        // payload 파싱 실패 시 이 수요산업은 건너뜀
      }
    }

    // 2) 큐레이션된 수요산업이 없으면 기존 자기 매트릭스 세그먼트×CAGR 파생으로 폴백.
    if (driverSensitivities.length === 0) {
      const latest = db
        .query(
          `SELECT v.payload FROM market_sizing_version v
           JOIN market_sizing_analysis a ON a.id = v.analysis_id
           WHERE a.industry_id = ? AND a.status = 'completed'
           ORDER BY v.version_no DESC LIMIT 1`,
        )
        .get(industryId) as { payload: string } | null;
      if (latest) {
        try {
          const matrix = (JSON.parse(latest.payload) as { matrix?: SizingMatrixShape }).matrix;
          // 세그먼트 단위로 집계해 표시한다 — 권역별 조합은 3단계(권역·세그먼트 배분)의 역할이고,
          // 1단계 축 정의에서는 산업의 세그먼트 구조만 보면 충분하다.
          const segs = matrix?.segments
            ?? [{ code: "construction", label: "건설" }, { code: "mining", label: "광산" }, { code: "other", label: "기타" }];
          const regions = matrix?.regions ?? [];
          for (const seg of segs) {
            let wSum = 0;
            let cagrSum = 0;
            for (const r of regions) {
              const base = matrix?.cagrBase?.[r.code]?.[seg.code] ?? 0;
              const w = matrix?.baseline2026?.[r.code]?.[seg.code] ?? 0;
              cagrSum += base * w;
              wSum += w;
            }
            const wCagr = wSum > 0 ? cagrSum / wSum : 0;
            driverSensitivities.push({
              driver_id: `derived-${seg.code}`,
              driver_label: `수요 규모 (${seg.label})`,
              sensitivity: Math.round(wCagr * 10 * 100) / 100,
              lag_months: 0,
              region_code: null,
              segment_code: seg.code,
              evidence_ref: "market-sizing-pipeline — 세그먼트 통합 CAGR 기반 파생 민감도 (권역 가중 평균)",
            });
          }
        } catch {
          // payload 파싱 실패 시 빈 배열 유지
        }
      }
    }
  }

  // Structure simulation results (regional demand scenarios)
  const simulations = db
    .query(
      `SELECT ss.scenario, ss.region_code, ss.segment_code, ss.metric,
              ss.p05, ss.p50, ss.p95
       FROM structure_simulation_result ss
       JOIN run r ON r.id = ss.run_id
       WHERE ss.industry_id = ?
       ORDER BY ss.scenario, ss.region_code, ss.p50`,
    )
    .all(industryId) as Array<{
    scenario: string; region_code: string | null; segment_code: string | null;
    metric: string; p05: number | null; p50: number | null; p95: number | null;
  }>;

  // Regional aggregation from simulations
  const regionMap = new Map<string, { region: string; scenarios: Set<string>; p50s: number[] }>();
  for (const s of simulations) {
    if (!s.region_code) continue;
    if (!regionMap.has(s.region_code)) {
      regionMap.set(s.region_code, { region: s.region_code, scenarios: new Set(), p50s: [] });
    }
    const entry = regionMap.get(s.region_code)!;
    entry.scenarios.add(s.scenario);
    if (s.p50 !== null) entry.p50s.push(s.p50);
  }
  const regions = [...regionMap.values()].map((r) => ({
    region: r.region,
    scenario_count: r.scenarios.size,
    avg_p50: r.p50s.length > 0 ? Math.round(r.p50s.reduce((a, b) => a + b, 0) / r.p50s.length) : null,
  }));

  // Time series observations for this industry
  const series = db
    .query(
      `SELECT fmo.series_id, fmo.period_id, fmo.value, fmo.unit_id, fmo.source_id,
              fmo.revision_no, fmo.fetched_at
       FROM fact_market_observation fmo
       WHERE fmo.series_id LIKE '%' || ? || '%'
       ORDER BY fmo.series_id, fmo.period_id`,
    )
    .all(industry.name_ko ?? industryId) as Array<{
    series_id: string; period_id: string; value: number; unit_id: string;
    source_id: string; revision_no: number; fetched_at: string;
  }>;

  // Assumption-registry rows for the market-sizing report (step 8 of the
  // systematic-market-sizing procedure): hb.* rows live on the seed run.
  const sizingRun = db
    .query("SELECT id FROM run WHERE label = ? ORDER BY created_at DESC LIMIT 1")
    .get("hydraulic-breaker-matrix-seed") as { id: string } | null;
  const sizingAssumptions = sizingRun
    ? db
        .query(
          `SELECT assumption_key, kind, value, rationale, anchor_ref, as_of, ttl_days
           FROM assumption WHERE run_id = ? AND assumption_key LIKE 'hb.%' ORDER BY assumption_key`,
        )
        .all(sizingRun.id) as Array<{
        assumption_key: string; kind: string; value: number; rationale: string | null;
        anchor_ref: string | null; as_of: string; ttl_days: number | null;
      }>
    : [];

  // 가치사슬 연계 — 링크(후방=공급처, 전방=수요처)와 체인 등급 (구칭: 프록시 체인).
  // S1 "가치사슬 구조" 산출물의 산업 단위 조회 surface가 된다.
  // ADR-0129 — id·relation/hop_distance/source/status를 함께 내려준다. 활성
  // 링크만 기본 chain.links에 포함하고(은퇴 링크는 제외), relation 미태깅
  // 레거시 행은 별도로 chain.legacyUntagged에 담아 검토 큐 UI가 소비하게 한다.
  const chainLinkRows = db
    .query(
      `SELECT pl.id, pl.hop_type, pl.coefficient, pl.beta, pl.r2, pl.lag_months, pl.evidence_ref,
              pl.relation, pl.hop_distance, pl.source, pl.status,
              i.id AS industry_id, i.name_ko,
              CASE WHEN pl.to_industry_id = ? THEN 'upstream' ELSE 'downstream' END AS direction
       FROM proxy_link pl
       JOIN md_industry i ON i.id = CASE WHEN pl.to_industry_id = ? THEN pl.from_industry_id ELSE pl.to_industry_id END
       WHERE (pl.from_industry_id = ? OR pl.to_industry_id = ?) AND pl.status = 'active'
       ORDER BY direction, i.name_ko`,
    )
    .all(industryId, industryId, industryId, industryId) as Array<{
    id: string; hop_type: "engineering" | "statistical" | "structural"; coefficient: number | null; beta: number | null; r2: number | null;
    lag_months: number | null; evidence_ref: string; relation: string | null; hop_distance: number | null;
    source: string; status: string; industry_id: string; name_ko: string; direction: "upstream" | "downstream";
  }>;
  const chainLinks = chainLinkRows.filter((r) => r.relation !== null);
  const legacyUntagged = chainLinkRows.filter((r) => r.relation === null);
  const chainGradeRow = db
    .query(
      "SELECT reliability_grade, grade_rationale FROM proxy_chain WHERE target_industry_id = ? LIMIT 1",
    )
    .get(industryId) as { reliability_grade: string; grade_rationale: string } | null;

  // ADR-0126 — S1 시장 구조 정의가 LLM으로 도출한 인접 산업을 md_industry와
  // 매칭해 승인 대기 제안으로 내려준다. 제안은 payload에서 매번 파생한다 —
  // 승인(POST chain-links) 전까지는 데이터가 아니다. 이미 등록된 링크는 제외.
  interface RelatedIndustry { relation: string; name: string; note?: string }
  const latestSizing = db
    .query(
      `SELECT v.payload FROM market_sizing_version v
       JOIN market_sizing_analysis a ON a.id = v.analysis_id
       WHERE a.industry_id = ? AND a.status = 'completed'
       ORDER BY v.version_no DESC LIMIT 1`,
    )
    .get(industryId) as { payload: string } | null;
  let related: RelatedIndustry[] = [];
  if (latestSizing) {
    try {
      // payload는 { methodology, matrix, stepSummaries } 구조 — chainDirection은
      // matrix 안에 있다(구형 payload는 최상위 폴백).
      const parsed = JSON.parse(latestSizing.payload) as {
        matrix?: { chainDirection?: { relatedIndustries?: RelatedIndustry[] } };
        chainDirection?: { relatedIndustries?: RelatedIndustry[] };
      };
      related = parsed.matrix?.chainDirection?.relatedIndustries ?? parsed.chainDirection?.relatedIndustries ?? [];
    } catch { /* unparseable payload = no proposals */ }
  }
  const existingLinkedIds = new Set(
    (
      db
        .query(
          `SELECT CASE WHEN from_industry_id = ? THEN to_industry_id ELSE from_industry_id END AS other
           FROM proxy_link WHERE from_industry_id = ? OR to_industry_id = ?`,
        )
        .all(industryId, industryId, industryId) as Array<{ other: string }>
    ).map((r) => r.other),
  );
  const proposals: Array<{ industry_id: string; name_ko: string; relation: string; note: string | null }> = [];
  const unmatchedProposals: Array<{ name: string; relation: string; note: string | null }> = [];
  // 이름 정규화 — 괄호 보충설명 제거 + 공백 제거 + 말미 "산업" 제거. LLM이
  // "수소 생산·저장·운송 산업"처럼 꾸민 이름도 마스터 이름과 비교 가능하게.
  const norm = (s: string) => s.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").replace(/\s+/g, "").replace(/산업$/, "");
  const allIndustries = db
    .query("SELECT id, name_ko FROM md_industry")
    .all() as Array<{ id: string; name_ko: string }>;
  for (const r of related) {
    const name = (r.name ?? "").trim();
    if (!name || name === "—") continue;
    const nName = norm(name);
    // 정규화 일치 또는 양방향 포함 — 단, 짧은 조각(3자 미만) 오매칭은 방지.
    const match = allIndustries.find((m) => {
      const nMaster = norm(m.name_ko);
      if (!nMaster || !nName) return false;
      if (m.id === industryId) return false;
      return nName === nMaster ||
        (nMaster.length >= 3 && nName.includes(nMaster)) ||
        (nName.length >= 3 && nMaster.includes(nName));
    });
    if (!match) { unmatchedProposals.push({ name, relation: r.relation, note: r.note ?? null }); continue; }
    if (existingLinkedIds.has(match.id)) continue;
    proposals.push({ industry_id: match.id, name_ko: match.name_ko, relation: r.relation, note: r.note ?? null });
  }

  return ok(
    {
      industry,
      chain: {
        links: chainLinks,
        legacyUntagged,
        grade: chainGradeRow,
      },
      proposals,
      unmatchedProposals,
      linkableIndustries: allIndustries
        .filter((m) => m.id !== industryId && !existingLinkedIds.has(m.id))
        .map((m) => ({ id: m.id, name_ko: m.name_ko })),
      driver_sensitivities: driverSensitivities,
      regions,
      simulations,
      series,
      sizing: sizingRun
        ? {
            run_id: sizingRun.id,
            run_label: "hydraulic-breaker-matrix-seed",
            assumptions: sizingAssumptions,
          }
        : null,
      versions: db
        .query(
          `SELECT v.version_no, v.changelog, v.created_by, v.created_at
           FROM market_sizing_version v
           JOIN market_sizing_analysis a ON a.id = v.analysis_id
           WHERE a.industry_id = ? ORDER BY v.version_no DESC`,
        )
        .all(industryId) as Array<{ version_no: number; changelog: string | null; created_by: string; created_at: string }>,
    },
    200,
    {
      drivers: driverSensitivities.length,
      regions: regions.length,
      simulations: simulations.length,
      series: series.length,
    },
  );
}

// 산업 정보 수정 — 산업명·KSIC 코드 변경 (analyst+).
export async function PATCH(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "Industry update requires the analyst role.");
  const { industryId } = await params;
  const body = (await request.json().catch(() => null)) as { name_ko?: string; ksic_code?: string | null } | null;
  const name = body?.name_ko?.trim();
  if (!name) return badRequest("invalid_request", "산업명은 필수입니다.");
  const ksic = parseKsicInput(body?.ksic_code);
  if (!ksic.ok) return badRequest("invalid_ksic_code", ksic.reason);
  const code = ksic.code;

  const db = getDb();
  const industry = db
    .query("SELECT id FROM md_industry WHERE id = ?")
    .get(industryId) as { id: string } | null;
  if (!industry) return notFound();

  try {
    db.query("UPDATE md_industry SET name_ko = ?, ksic_code = ? WHERE id = ?").run(name, code, industryId);
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE")) {
      return fail(409, "code_in_use", `KSIC 코드 ${code}는 이미 다른 산업에 할당되어 있습니다.`);
    }
    return fail(500, "update_failed", `산업 정보 수정 중 오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`);
  }
  const updated = db
    .query("SELECT id, name_ko, name_en, ksic_code, naics_code FROM md_industry WHERE id = ?")
    .get(industryId);
  return ok(updated, 200);
}

// 산업 삭제 — market-sizing 분석 레지스트리와 함께 제거한다. 가치사슬·검토/안건 등
// 다른 도메인이 이 산업을 참조하면 FK 제약으로 삭제가 차단된다(409).
export async function DELETE(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "Industry deletion requires the analyst role.");
  const { industryId } = await params;
  const db = getDb();

  const industry = db
    .query("SELECT id, name_ko FROM md_industry WHERE id = ?")
    .get(industryId) as { id: string; name_ko: string } | null;
  if (!industry) return notFound();

  try {
    db.query("BEGIN").run();
    // 시장분석 버전·분석 레지스트리부터 정리한다 (append-only 버전 행 포함).
    db.query(
      `DELETE FROM market_sizing_version WHERE analysis_id IN (SELECT id FROM market_sizing_analysis WHERE industry_id = ?)`,
    ).run(industryId);
    db.query("DELETE FROM market_sizing_analysis WHERE industry_id = ?").run(industryId);
    // S2 연동 정리 — 이 산업에서 발굴되어 아직 검토/안건으로 승격되지 않은 기회는 함께 삭제한다
    // (S1 삭제가 S2 파생 데이터를 남기지 않도록). 승격된 기회(project_id 있음)는
    // 이력 보호를 위해 유지하고 market_scope만 해제한다.
    db.run(
      "DELETE FROM opportunity WHERE market_scope = ? AND project_id IS NULL",
      [industry.name_ko],
    );
    db.run(
      "UPDATE opportunity SET market_scope = NULL WHERE market_scope = ? AND project_id IS NOT NULL",
      [industry.name_ko],
    );
    db.query("DELETE FROM md_industry WHERE id = ?").run(industryId);
    db.query("COMMIT").run();
  } catch (err) {
    try { db.query("ROLLBACK").run(); } catch { /* no open transaction */ }
    const msg = err instanceof Error ? err.message : String(err);
    if (/FOREIGN KEY|constraint/i.test(msg)) {
      return fail(409, "industry_in_use", "이 산업은 가치사슬·검토/안건 등 다른 데이터에서 참조 중이어서 삭제할 수 없습니다.");
    }
    return fail(500, "delete_failed", `산업 삭제 중 오류가 발생했습니다: ${msg}`);
  }

  return ok({ deleted: industry.id, name_ko: industry.name_ko }, 200);
}
