#!/usr/bin/env bun
// @version 1.1.0
/**
 * Backfills the hydraulic-breaker research report as a REGULAR market-sizing
 * analysis version — the one-time migration that retires the HYD-BRK sentinel
 * (ADR-0112). Before this script, the breaker report was rendered from a
 * hardcoded frontend constant; now the matrix lives in
 * market_sizing_version.payload like every other analysis.
 *
 * Idempotent — safe to re-run:
 *   1. finds the 유압브레이커 industry (legacy sentinel code or 29241),
 *   2. ensures a completed market_sizing_analysis row exists,
 *   3. appends a new version carrying the matrix payload unless the latest
 *      version already has one,
 *   4. remaps a legacy ksic_code 'HYD-BRK' to '29241' (건설 및 채광용 기계장비
 *      제조업 — verified via DART-registered induty code of Soosan group
 *      service affiliate; collision falls back to NULL).
 *
 * Usage: bun scripts/co-newbiz/backfill-hyd-brk-report.ts
 */

import { getDb } from "../../db/client.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { appendAudit } from "../../db/lib/access-control.ts";
import { deriveDataConfidence } from "../../db/lib/data-confidence.ts";
import type { SizingMatrix } from "../../app/web-next/lib/market-sizing.ts";

const SOURCE_DOC = "docs/research/hydraulic-breaker-market-2026-driver-analysis.md";
const REAL_KSIC = "29241";
const LEGACY_KSIC = "HYD-BRK";

/* ── Frozen hydraulic-breaker matrix (analysis of record, 2026-08) ── */

const HYD_REGIONS: MatrixRegion[] = [
  { code: "china", label: "중국", weight: 26, mix: { construction: 46, mining: 36, other: 18 }, adjustment: "글로벌 조정: 건설 −2%p / 광산 +2%p (Epiroc FY2025)" },
  { code: "apac_ex_china", label: "아시아(중국 제외)", weight: 14, mix: { construction: 29, mining: 57, other: 14 }, adjustment: "글로벌 조정 + 호주 광산 가중" },
  { code: "north_america", label: "북미", weight: 18, mix: { construction: 28, mining: 42, other: 30 }, adjustment: "건설 −8%p / 기타 +8%p (Stanley Infrastructure 인수)" },
  { code: "europe", label: "유럽", weight: 24, mix: { construction: 35, mining: 15, other: 50 }, adjustment: "글로벌 조정 + EU Stage V 규제 프리미엄(기타)" },
  { code: "mea", label: "중동·아프리카", weight: 8, mix: { construction: 45, mining: 42, other: 13 }, adjustment: "가중치 10%→8% 하향(권역 비중 4.9% 확인)" },
  { code: "latam_row", label: "중남미/기타", weight: 9, mix: { construction: 23, mining: 67, other: 10 }, adjustment: "최고 광산 집중(칠레/페루 구리)" },
];

const HYD_BRK_MATRIX = {
  industryLabel: "유압브레이커",
  provenance: "frozen-research",
  anchor: {
    sources: [
      { label: "소스 #1 (밴더 리포트 A)", estimate: 2.18, status: "consensus", note: "컨센서스 밴드 상단" },
      { label: "소스 #2 (밴더 리포트 B)", estimate: 2.0, status: "consensus", note: "컨센서스 밴드 하단 — 앵커로 채택" },
      { label: "소스 #3 (외삽 추정치)", estimate: 3.83, status: "excluded", note: "이상치 — 앵커에서 제외" },
    ],
    total: 2.0,
  },
  regions: HYD_REGIONS,
  baseline2026: {
    china: { construction: 0.239, mining: 0.187, other: 0.094 },
    apac_ex_china: { construction: 0.081, mining: 0.16, other: 0.039 },
    north_america: { construction: 0.101, mining: 0.151, other: 0.108 },
    europe: { construction: 0.168, mining: 0.072, other: 0.24 },
    mea: { construction: 0.072, mining: 0.067, other: 0.021 },
    latam_row: { construction: 0.041, mining: 0.121, other: 0.018 },
  },
  cagrBase: {
    china: { construction: 0.06, mining: 0.05, other: 0.05 },
    apac_ex_china: { construction: 0.07, mining: 0.09, other: 0.06 },
    north_america: { construction: 0.05, mining: 0.06, other: 0.05 },
    europe: { construction: 0.05, mining: 0.04, other: 0.06 },
    mea: { construction: 0.07, mining: 0.06, other: 0.05 },
    latam_row: { construction: 0.04, mining: 0.08, other: 0.04 },
  },
  bandOverrides: {
    "north_america|mining": { down: 0.02, up: 0.11, reason: "문서화된 소스 불일치 — 권역 최대 수요 세그먼트에 대한 소스 클래스 상충" },
  },
  chainGrade: {
    grade: "B",
    statisticalHops: 3,
    note: "프록시 체인 통계 hop 3개 — 스킬(proxy-industry-chain) 규정상 상한 B. 이 매트릭스의 어떤 결론도 Green 확신도로 표현될 수 없음.",
  },
  chainDirection: {
    position: "midstream",
    note: "유압브레이커는 건설·광산 장비의 어태치먼트(중류) — 수요 구조가 지배적이므로 전방(장비 제조·보유)과 전전방(인프라·광산 개발 수요)을 분석한다.",
    relatedIndustries: [
      { relation: "전방", name: "건설·광산 장비 제조 (Epiroc, Sandvik, HD Hyundai 등)", note: "어태치먼트 수요의 직접 수요처" },
      { relation: "전방", name: "장비 임대·렌탈업", note: "기계장착형 수요의 실질 보유 주체" },
      { relation: "전전방", name: "인프라 건설·광산 개발", note: "최종 수요 발생지 — 구리·금 광산 캐펙스가 핵심 드라이버" },
    ],
  },
  competitive: {
    structure:
      "과점형 니치 어태치먼트 시장 — CR4(Epiroc·Sandvik·Caterpillar·Atlas Copco) 합산 점유율 약 15~20% (source #21). 장비 제조사 자사 브랜드 번들과 독립 어태치먼트 브랜드가 공존하며, 광산(대형)은 글로벌 브랜드·건설(중소)은 지역 브랜드로 이원화.",
    players: [
      {
        name: "Epiroc (Stanley·AT)",
        tier: "leader",
        note: "어태치먼트 카테고리 리더 — FY2025 매출 SEK 62.0bn, Stanley Infrastructure 인수(2024)로 북미 특수 어태치먼트 확대 (source #22, 1차 공시)",
      },
      {
        name: "Sandvik / Rammer",
        tier: "leader",
        note: "광산·채석장 세그먼트 강자 — 파트·서비스 매출 비중이 높은 프리미엄 포지션",
      },
      {
        name: "Caterpillar",
        tier: "challenger",
        note: "자사 굴착장비(H 라인) 번들 중심 — CR4 구성원 (source #21)",
      },
      {
        name: "Atlas Copco 계열",
        tier: "challenger",
        note: "CR4 구성원 (source #21)",
      },
      {
        name: "Komatsu / Montabert",
        tier: "challenger",
        note: "자사 굴착장비 번들 — Montabert 브랜드 (문서 §6 top-10 목록)",
      },
      {
        name: "HD Hyundai / Develon (현대중공업그룹)",
        tier: "niche",
        note: "한국·아시아권 자사 장비 번들 중심 (문서 §6 top-10 목록)",
      },
    ],
  },
  qualitative: {
    opportunityFactors: [
      "광산 캐펙스 회복(구리·금) — 기계장착형 브레이커 수요 직결",
      "EU Stage V 등 배출 규제 — 구형 장비 교체 수요 촉발",
      "장비 임대 시장 성장 — 중고 시장 보유효율 개선에 따른 신규 수요",
    ],
    riskFactors: [
      "중국 인프라 경기 둔화 — 물량 최대 권역의 수요 급변 위험",
      "장비 제조사 자체 어태치먼트 사업 확대(수직계열화) — 독립 부품 수요 잠식",
      "중고 브레이커 유통 확대 — 신규 판매 대체",
    ],
    sources: [{ title: "Epiroc Annual and Sustainability Report 2025", url: "https://www.epirocgroup.com/", snippet: "1차 공시 — 광산 강세/인프라 약세 확인" }],
  },
  consistency: {
    bottomUpCagr: 5.7,
    topDownCagr: 6.3,
    tolerance: "허용 오차 내 — 내부 정합성 확인으로만 사용. 양쪽 모두 같은 부류(밴더 리포트)로 소급되므로 독립적 확인이 아님.",
  },
  crossValidation: [
    { claim: "광산(D3)이 2025년 건설(D1)보다 높은 성장", status: "confirmed", evidence: "Epiroc FY2025: \"mining customers remained strong, driven by copper and gold… infrastructure customers remained at a low level, mainly explained by a weak market for attachments\"" },
    { claim: "중국·서유럽·북미가 상위 가중 권역", status: "directional", evidence: "Epiroc 최대 시장 = 미국·서유럽·중국·인도 (상대 서열·비중은 미확인)" },
    { claim: "MEA·중남미는 마이너 권역", status: "confirmed", evidence: "Epiroc '최대 시장' 목록에서 부재" },
    { claim: "북미 '기타'(특수철거 어태치먼트) 실재·성장 포켓", status: "confirmed", evidence: "Stanley Infrastructure 인수(2024, ~SEK 4.7bn) — 미국 특수 어태치먼트 확장 목적" },
    { claim: "지역×세그먼트 교차 매출 정밀 검증", status: "impossible", evidence: "구조적 공시 한계 — 카테고리가 상위 보고 단위에 묻힘. Off-Highway Research·KHL Yellow Table 등 유료 소스로만 해소 가능" },
  ],
  limitations: [
    "권역 가중치는 더 넓은 건설장비 시장의 프록시 — 브레이커 특화 권역 매출 분할은 공개 소스에 없음.",
    "권역별 세그먼트 믹스는 글로벌 교차검증치에 맞춘 정성적 배분 — 소스 기반 바텀업 합산이 아님.",
    "북미 광산 밴드(2–11% CAGR)는 모델링 불확실성이 아닌 실제 소스 불일치 — 유료 데이터 확보 시 첫 번째 해소 대상.",
    "유럽 규제 프리미엄(EU Stage V)은 특정 규제 일정에 연동되지 않은 판단적 보정.",
    "중국 2025–2026 반등(굴삭기 판매 +17~27% YoY)은 저기저 반등 — 기본 CAGR(6%)는 정규화를 가정, 현 반등율 선형 외삽 금지.",
    "체인 등급 B 상한(통계 hop 3개) — 본 매트릭스 기반 결론은 Green 확신도로 표현 불가.",
  ],
};

function main(): void {
  const db = getDb();
  const now = new Date().toISOString();

  // 이름 변형(유압브레이커/유압식 브레이커 등)까지 커버 — 센티널 코드 우선.
  const industry = db.query(
    "SELECT id, ksic_code, name_ko FROM md_industry WHERE ksic_code IN (?, ?) OR name_ko LIKE '%브레이커%' ORDER BY CASE WHEN ksic_code = ? THEN 0 ELSE 1 END LIMIT 1",
  ).get(LEGACY_KSIC, REAL_KSIC, REAL_KSIC) as
    | { id: string; ksic_code: string | null; name_ko: string }
    | undefined;
  if (!industry) {
    console.error("유압브레이커 industry row not found — nothing to backfill.");
    process.exit(1);
  }

  db.transaction(() => {
    // 1. legacy sentinel code or 미지정 → real KSIC (collision-guarded, fallback NULL)
    if (industry.ksic_code === LEGACY_KSIC || industry.ksic_code === null) {
      const taken = db.query("SELECT 1 FROM md_industry WHERE ksic_code = ?").get(REAL_KSIC);
      db.run("UPDATE md_industry SET ksic_code = ? WHERE id = ?", [taken ? null : REAL_KSIC, industry.id]);
    }

    // 2. ensure a completed analysis row exists
    let analysis = db.query("SELECT id, status FROM market_sizing_analysis WHERE industry_id = ? ORDER BY created_at DESC LIMIT 1").get(industry.id) as { id: string; status: string } | undefined;
    if (!analysis) {
      const id = ulid();
      db.run(
        `INSERT INTO market_sizing_analysis (id, industry_id, status, current_step, methodology_version, created_by, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [id, industry.id, "in_progress", 8, "1.1.0", "backfill-hyd-brk-report.ts", now],
      );
      analysis = { id, status: "in_progress" };
    }

    // 3. append the matrix version unless the latest version already carries one
    const latest = db.query("SELECT version_no, payload FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1").get(analysis.id) as { version_no: number; payload: string } | undefined;
    const alreadyHasMatrix = latest ? (() => { try { return Boolean((JSON.parse(latest.payload) as { matrix?: unknown }).matrix); } catch { return false; } })() : false;
    if (alreadyHasMatrix) {
      console.log(`유압브레이커 analysis ${analysis.id} already carries a matrix version (v${latest!.version_no}) — nothing to backfill.`);
      return;
    }
    const versionNo = (latest?.version_no ?? 0) + 1;
    const versionId = ulid();
    const confidence = deriveDataConfidence(db, industry.id, (HYD_BRK_MATRIX as SizingMatrix).provenance ?? null);
    db.run(
      `INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, changelog, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        versionId,
        analysis.id,
        versionNo,
        JSON.stringify({ matrix: HYD_BRK_MATRIX as SizingMatrix }),
        `연구문서 시드 — 수동 조사 매트릭스를 정식 버전으로 영속화 (HYD-BRK 센티널 은퇴, ${SOURCE_DOC}; ADR-0112)`,
        "backfill-hyd-brk-report.ts",
        now,
        confidence.grade,
        confidence.chainHops,
        confidence.basis,
      ],
    );

    // 4. mark the analysis completed
    if (analysis.status !== "completed") {
      db.run("UPDATE market_sizing_analysis SET status = 'completed', current_step = 8, completed_at = COALESCE(completed_at, ?) WHERE id = ?", [now, analysis.id]);
    }

    appendAudit(db, {
      actor: "backfill-hyd-brk-report.ts",
      action: "market_sizing_version.backfill",
      target: versionId,
      now,
    });
    console.log(`Backfilled 유압브레이커 report: analysis ${analysis.id}, new version v${versionNo} (${industry.ksic_code === LEGACY_KSIC ? `ksic ${LEGACY_KSIC} → ${REAL_KSIC}` : `ksic ${industry.ksic_code}`}).`);
  })();
}

main();
