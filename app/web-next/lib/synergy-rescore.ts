// synergy-rescore — ADR-0182 (2026-10-18 decider request): convert a legacy
// 4-factor stored payload to the CURRENT scoring scheme WITHOUT a full
// pipeline rerun. Deterministic rule recompute (computeSynergyScore with the
// current SYNERGY_FACTOR_WEIGHTS — 시장 30%·교집합 25%·재무 15%·일치도 10%·
// 충족도 20%) over the CURRENT stored state (S1 completed markets, group/
// affiliate profile, capability register), plus the same bounded (±10) LLM
// adjustment the pipeline applies. Appends a NEW synergy_version (append-only
// — nothing is overwritten) and follows the rerun rule for the opportunity
// recommendation: a different score invalidates the person's confirmation,
// the same score keeps it (recordSynergyRecommendation). Analyst+ initiated;
// the LLM adjustment is draft-grade exactly as at analysis time (boundary #2
// — the confirm editor stays the human act).
import type { Database } from "bun:sqlite";
import { ulid } from "../../../db/lib/ulid.ts";
import { completeOrFallback, isLlmConfigured } from "./llm.ts";
import { systemMessage, promptAgent, type PromptKey } from "./prompts.ts";
import { parseGapRegister, summarizeGap } from "./capability-gap.ts";
import { computeSynergyScore } from "./synergy-score.ts";
import { recordSynergyRecommendation, type SynergyPayload } from "./synergy-pipeline.ts";

async function askJson(promptKey: PromptKey, user: string, maxTokens = 800): Promise<Record<string, unknown> | null> {
  const res = await completeOrFallback(
    [systemMessage(promptKey), { role: "user", content: user }],
    () => "NOT_JSON",
    { temperature: 0.2, maxTokens, agent: promptAgent(promptKey) },
  );
  if (res.source !== "llm") return null;
  const text = res.text.replace(/```json|```/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type RescoreError = "ANALYSIS_NOT_FOUND" | "NO_LATEST_VERSION" | "NO_OPPORTUNITY";

export interface RescoreResult {
  versionNo: number;
  score: number | null;
  method: "rule-based" | "hybrid";
  capabilityCoverage: number | null;
  factorKeys: string[];
}

export async function rescoreLatestVersion(db: Database, analysisId: string, userId: string): Promise<RescoreResult> {
  const row = db
    .query(
      `SELECT sa.id, sa.opportunity_id, sa.member_id, sa.group_id, sa.target_type,
              m.company_name AS member_name, c.name_ko AS legacy_name
       FROM synergy_analysis sa
       LEFT JOIN company_group_member m ON m.id = sa.member_id
       LEFT JOIN md_company c ON c.id = sa.company_id
       WHERE sa.id = ?`,
    )
    .get(analysisId) as
    | { id: string; opportunity_id: string | null; member_id: string | null; group_id: string | null; target_type: "affiliate" | "group" | null; member_name: string | null; legacy_name: string | null }
    | undefined;
  if (!row) throw new Error("ANALYSIS_NOT_FOUND");
  if (!row.opportunity_id) throw new Error("NO_OPPORTUNITY");
  const latest = db
    .query("SELECT version_no, payload FROM synergy_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1")
    .get(analysisId) as { version_no: number; payload: string } | undefined;
  if (!latest) throw new Error("NO_LATEST_VERSION");
  let p: SynergyPayload;
  try {
    p = JSON.parse(latest.payload) as SynergyPayload;
  } catch {
    throw new Error("NO_LATEST_VERSION");
  }

  const oppRow = db.query("SELECT id, name, market_scope FROM opportunity WHERE id = ?").get(row.opportunity_id) as { id: string; name: string; market_scope: string | null };

  // ── S1 completed markets — the same read the pipeline scores from ──
  const completedMarkets = db
    .query(
      `SELECT i.name_ko, v.payload FROM market_sizing_analysis a
       JOIN md_industry i ON i.id = a.industry_id
       JOIN market_sizing_version v ON v.analysis_id = a.id
       WHERE a.status = 'completed'
         AND v.version_no = (SELECT MAX(version_no) FROM market_sizing_version x WHERE x.analysis_id = a.id)
       ORDER BY a.completed_at DESC LIMIT 6`,
    )
    .all() as Array<{ name_ko: string; payload: string }>;
  type EfShape = { cagr?: number; gapPct?: number; newDrivers?: string[]; targetYear?: number } | null;
  const markets = completedMarkets.map((m) => {
    let cagrPct: number | null = null;
    let relatedIndustries: string[] = [];
    try {
      const matrix = (JSON.parse(m.payload) as { matrix?: { consistency?: { bottomUpCagr?: number }; chainDirection?: { relatedIndustries?: Array<{ name?: string }> } } }).matrix;
      cagrPct = matrix?.consistency?.bottomUpCagr ?? null;
      relatedIndustries = (matrix?.chainDirection?.relatedIndustries ?? []).map((r) => String(r?.name ?? "")).filter(Boolean);
    } catch { /* skip malformed */ }
    return { industry: m.name_ko, cagr: cagrPct === null ? null : cagrPct > 1 ? cagrPct / 100 : cagrPct, relatedIndustries };
  });

  // ── Profile scoring inputs — fresh from the registry (affiliate: the member
  // profile; group: exposure union + the member with the richest financials —
  // the same roll-up the pipeline uses). Legacy rows score without a profile,
  // exactly as the pipeline's legacy path does. Strengths stay from the STORED
  // payload so the recomputed score keeps the stored analysis's narrative.
  type ScoreProfile = { industryExposure: string[]; strengths: string[]; ratios: Array<{ year: string; debtRatio?: number | null; roe?: number | null; operatingMargin?: number | null }> } | null;
  let profile: ScoreProfile = null;
  let company = row.legacy_name ?? "";
  if (row.target_type === "affiliate" && row.member_id) {
    const { loadLatestProfile } = await import("./company-profile-pipeline.ts");
    const prof = loadLatestProfile(db, { kind: "member", id: row.member_id });
    company = row.member_name ?? row.legacy_name ?? "";
    if (prof) {
      profile = { industryExposure: prof.industryExposure ?? [], strengths: p.financialStrengths ?? [], ratios: prof.financialAnalysis?.ratios ?? [] };
    }
  } else if (row.target_type === "group" && row.group_id) {
    const { loadLatestProfile } = await import("./company-profile-pipeline.ts");
    const members = db.query("SELECT id FROM company_group_member WHERE group_id = ?").all(row.group_id) as Array<{ id: string }>;
    const exposures = new Set<string>();
    let best: ReturnType<typeof loadLatestProfile> = null;
    for (const m of members) {
      const prof = loadLatestProfile(db, { kind: "member", id: m.id });
      if (!prof) continue;
      (prof.industryExposure ?? []).forEach((x) => exposures.add(x));
      if (!best || (prof.dartFinancials?.items?.length ?? 0) > (best.dartFinancials?.items?.length ?? 0)) best = prof;
    }
    if (best) {
      profile = { industryExposure: [...exposures], strengths: p.financialStrengths ?? [], ratios: best.financialAnalysis?.ratios ?? [] };
    }
  }

  // ── Capability coverage — the same register read/blend the pipeline scores from ──
  let capabilityCoverage: number | null = null;
  let capabilityCoverageNote: string | null = null;
  const storedGapJson = (db.query("SELECT capability_gap_json FROM opportunity WHERE id = ?").get(oppRow.id) as { capability_gap_json: string | null } | undefined)?.capability_gap_json ?? null;
  const reg = parseGapRegister(storedGapJson);
  if (reg.rows.length > 0) {
    const s = summarizeGap(reg.rows);
    const essential = s.essentialCoveragePct;
    if (s.evaluated > 0) {
      capabilityCoverage = essential !== null && s.coveragePct !== null ? Math.round(s.coveragePct * 0.5 + essential * 0.5) : s.coveragePct;
      capabilityCoverageNote = `필요 역량 ${s.total}건 중 판정 ${s.evaluated}건 — 보유율 ${s.coveragePct !== null ? s.coveragePct + "%" : "—"}, 필수 충족율 ${essential !== null ? essential + "%" : "—"}`;
    } else {
      capabilityCoverageNote = `필요 역량 ${s.total}건 모두 미판정 — 충족도 팩터 미반영`;
    }
  }

  const rule = computeSynergyScore({
    opportunity: { market_scope: oppRow.market_scope, value_chain_node: null, name: oppRow.name },
    profile,
    markets,
    capabilityCoverage,
    capabilityCoverageNote,
  });
  let score = rule.score;
  let method: "rule-based" | "hybrid" = "rule-based";
  const considered = rule.factors.filter((f) => f.value !== null).map((f) => f.label);
  let rationale: string | null = rule.score !== null
    ? `규칙 기반 종합 판단 — 반영 요소: ${considered.join(", ") || "—"}.${rule.missing.length ? ` 미반영: ${rule.missing.join("; ")}.` : ""} (현재 5팩터 체계로 재계산)`
    : null;
  let adjustmentDelta = 0;
  let adjustmentReason = "";
  if (oppRow && isLlmConfigured() && rule.score !== null) {
    const areas = (p.marketLinkage?.synergyAreas ?? []).map((a) => a.area).join(", ");
    const adj = await askJson(
      "s3.synergy_ic",
      `규칙 기반 시너지 점수: ${rule.score} (인자: ${JSON.stringify(rule.factors)})\n대상: ${company}, 연결 기회: ${oppRow.name}\n강점: ${(p.financialStrengths ?? []).join(" / ")}\n시너지 영역: ${areas || "없음"}\n\nJSON: {"adjustment": <-10..10 정수>, "reason": "<보정 사유 1~2문장, 정성 근거 명시>"} — 데이터가 부족하면 adjustment 0.`,
    );
    if (adj) {
      const delta = typeof adj.adjustment === "number" ? Math.max(-10, Math.min(10, Math.round(adj.adjustment))) : 0;
      if (delta !== 0) {
        score = Math.max(0, Math.min(100, (rule.score as number) + delta));
        method = "hybrid";
        rationale = String(adj.reason ?? rationale);
      } else if (adj.reason) {
        rationale = String(adj.reason);
      }
      adjustmentDelta = delta;
      adjustmentReason = String(adj.reason ?? "");
    }
  }

  const newPayload: SynergyPayload = {
    ...p,
    synergyScore: oppRow ? score : p.synergyScore ?? null,
    synergyRationale: rationale ?? p.synergyRationale ?? null,
    synergyScoreFactors: rule.factors,
    scoreAdjustment: adjustmentDelta !== 0 || adjustmentReason ? { delta: adjustmentDelta, reason: adjustmentReason } : null,
    capabilityCoverage,
    capabilityCoverageNote,
  };
  const versionNo = ((db.query("SELECT MAX(version_no) m FROM synergy_version WHERE analysis_id = ?").get(analysisId) as { m: number | null }).m ?? 0) + 1;
  db.run(
    `INSERT INTO synergy_version (id, analysis_id, version_no, payload, changelog, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [ulid(), analysisId, versionNo, JSON.stringify(newPayload), `현재 5팩터 체계로 재계산 (구 저장분 전환) — 규칙 ${rule.score ?? "불가"}${adjustmentDelta !== 0 ? ` · LLM 보정 ${adjustmentDelta > 0 ? "+" : ""}${adjustmentDelta}` : ""}`, userId, new Date().toISOString()],
  );
  if (score !== null && score !== undefined) {
    recordSynergyRecommendation(db, oppRow.id, Math.max(0, Math.min(100, Math.round(score))), rationale);
  }
  return { versionNo, score, method, capabilityCoverage, factorKeys: rule.factors.filter((f) => f.value !== null).map((f) => f.key) };
}
