// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { PROFILE_TABS } from "./constants.ts";

export interface GroupRow {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
}
export interface MemberRow {
  id: string;
  company_name: string;
  dart_corp_code: string | null;
  role: "hq" | "affiliate";
  created_at: string;
  latest_version: number | null;
  analyzed_at: string | null;
}
export interface Profile {
  companyName: string;
  dartFinancials?: {
    available?: boolean;
    year?: string;
    items?: Array<{ name: string; value: number; year?: string; fsDiv?: string }>;
    reportUrl?: string;
    error?: string;
    fsDiv?: "CFS" | "BFS" | "mixed";
  };
  strengths?: string[];
  weaknesses?: string[];
  businessAssessment?: string;
  industryExposure?: string[];
  degraded?: string | null;
  researchSources?: Array<{ title: string; url: string; snippet?: string; provided?: boolean }>;
  dataSources?: {
    dart: boolean;
    dartYear: string | null;
    creditReport: string | null;
    webResearchCount: number;
    userSourceCount?: number;
    userSources?: Array<{
      url: string;
      title?: string;
      fetched: boolean;
      charCount: number;
      status: "ok" | "thin" | "failed";
      reason?: string;
      provided?: boolean;
      manual?: boolean;
      id?: string;
      addedBy?: string;
      addedAt?: string;
      excerpt?: string;
      removed?: boolean;
    }>;
    analystNote?: boolean;
    /** True when the chain-integrated Playwright headless provider rescued a fully-blocked search
     * (design 2026-11-13-profile-headless-fallback) — provenance for the same webResearchCount. */
    webResearchPlaywright?: boolean;
  };
  /** Analyst's free-text company note stored with the version (ADR-0172 amendment 4). */
  userNote?: string;
  analystEdited?: {
    industryExposure: string[];
    strengths: string[];
    weaknesses: string[];
    businessAssessment: boolean;
  };
  analystEditLog?: Array<{ fields: string[]; reason: string; source?: string; editedBy: string; editedAt: string }>;
  // ── ADR-0093 확장 (schemaVersion 2) — 구 v1 payload에는 없는 optional 필드 ──
  financialAnalysis?: {
    available: boolean;
    years: string[];
    series: Array<{ key: string; label: string; points: Array<{ year: string; value: number | null }> }>;
    ratios: Array<{
      year: string;
      revenueGrowth?: number | null;
      operatingMargin?: number | null;
      netMargin?: number | null;
      debtRatio?: number | null;
      roe?: number | null;
    }>;
    missingAccounts: string[];
    notes: string[];
  };
  swot?: { opportunities: string[]; threats: string[] };
  /** Per-item grounding tag (schemaVersion 3, additive) — index-aligned with the item arrays;
   * "financial" items render a financial-grounded chip when DART data was available. */
  itemBasis?: {
    strengths?: Array<"financial" | "estimate">;
    weaknesses?: Array<"financial" | "estimate">;
    opportunities?: Array<"financial" | "estimate">;
    threats?: Array<"financial" | "estimate">;
  };
  // schemaVersion 3 — 공시·리서치 원문 대조 (ADR-0113)
  competitive?: {
    competitors: Array<{ name: string; note: string }>;
    positioning: string;
    degraded?: string | null;
    crossCheck?: CompetitiveCrossCheck;
  };
  industryLinkage?: Array<{
    industry: string;
    industryId: string | null;
    matrixFound: boolean;
    anchorTotalUsdB?: number | null;
    cagr?: number | null;
    externalGapPercent?: number | null;
    qualitativeLinks?: { opportunityFactors: string[]; riskFactors: string[] };
    note?: string;
  }>;
  sectionConfidence?: Array<{ section: string; grade: string; note: string }>;
  verificationLedger?: Array<{
    item: string;
    status: "confirmed" | "could_not_verify" | "needs_judgement";
    evidence: string;
  }>;
  ragCapRecommendation?: { grade: "green" | "amber" | "red"; rationale: string };
  stepSummaries?: Array<{ step: number; title: string; summary: string; source: string }>;
  schemaVersion?: number;
}
export interface GroupDetail {
  group: { id: string; name: string; created_at: string };
  members: MemberRow[];
  profiles: Array<{
    member_id: string;
    company_name: string;
    role: string;
    latest_version: number | null;
    profile: Profile | null;
  }>;
}

export type ProfileTabKey = (typeof PROFILE_TABS)[number][0];

// ── 경쟁 포지셔닝 공시·리서치 원문 대조 (schemaVersion 3, ADR-0113) ──
export type CrossCheckVerdict = "confirmed" | "directional" | "contradicted" | "unverified";
export interface CompetitiveCrossCheck {
  status: "cross_checked" | "dart_unavailable" | "research_only";
  checkedAt: string;
  dartReport?: { rceptNo: string; reportNm: string; rceptDt: string; reportUrl: string } | null;
  claims: Array<{ claim: string; verdict: CrossCheckVerdict; source: string; evidence: string; url?: string }>;
  note?: string;
}

// 경쟁사 레지스트리 (ADR-0142) — 확정 목록은 사람의 수용/등록으로만 생기고,
// payload 경쟁사는 "제안"으로만 표시된다.
export interface CompetitorRowView {
  id: string;
  name: string;
  dart_corp_code: string | null;
  note: string | null;
  status: "confirmed" | "excluded";
  exclusion_reason: string | null;
  discovery_source: "manual" | "ai_proposal";
  proposal_accepted_at: string;
  crosscheck_verdict: string | null;
  evidence_json: string | null;
}

export interface CompetitorProposalView {
  name: string;
  note: string;
  verdict: string | null;
  evidence: Array<{ title: string | null; url: string }>;
  accepted: boolean;
}

// 웹검색 재제안 (ADR-0142 후속) — 실검색 근거 기반 제안(저장 없음, 수용은 사람)
export interface WebSuggestionView {
  name: string;
  note: string;
  reliability: "A" | "B" | "C";
  sources: Array<{ title: string; url: string }>;
}
