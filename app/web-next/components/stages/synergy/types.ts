// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { type CapabilityGapRow } from "../../../lib/capability-gap.ts";

export interface SynergyStepSummary { step: number; title: string; summary: string; source: string }
export interface SynergySourceRef { title: string; url: string; snippet?: string }
export interface SynergyPayload {
  company: { name: string; dartCorpCode: string | null };
  dartFinancials: { available: boolean; year?: string; items?: Array<{ name: string; value: number; year?: string; fsDiv?: string }>; reportUrl?: string; error?: string; fsDiv?: "CFS" | "BFS" | "mixed"; fsDivLabel?: string; integrity?: string | null; integrityNotes?: string[] };
  /** 재무 데이터 출처 — DART / 신용평가자료 / 외부 검색 (구형 버전에는 없음) */
  dataSources?: { dart: boolean; dartYear: string | null; creditReport: string | null; webResearchCount: number };
  researchSources: SynergySourceRef[];
  financialStrengths: string[];
  financialWeaknesses: string[];
  businessAssessment: string;
  marketLinkage: {
    marketSummaries: Array<{ industry: string; cagrPct: number | null; gapPct: number | null; newDrivers: string[] }>;
    synergyAreas: Array<{ area: string; synergyType: string; rationale: string; opportunity: string; risk: string; sources: string[]; origin?: "llm" | "human" }>;
  };
  shortList: Array<{ rank: number; area: string; verdict: string; reason: string; origin?: "llm" | "human"; editedBy?: string | null; editedAt?: string | null }>;
  stepSummaries: SynergyStepSummary[];
  target?: { type: "affiliate" | "group"; name: string };
  opportunity?: { id: string; name: string } | null;
  synergyScore?: number | null;
  synergyRationale?: string | null;
  /** ADR-0103/0182 — 팩터 분해·충족도·보정 이력 */
  scoringMethod?: string;
  synergyScoreFactors?: unknown;
  synergyScoreLimitations?: string[];
  capabilityCoverage?: number | null;
  capabilityCoverageNote?: string | null;
  scoreAdjustment?: { delta: number; reason: string } | null;
  /** ADR-0094 — 재사용된 프로파일 딥링크 (상세 재무·SWOT는 /our-company 담당) */
  profileRef?: { kind: "affiliate" | "group"; id: string; label: string; profileVersion: number | null };
}
export interface SynergyAnalysis {
  id: string; status: "in_progress" | "completed"; current_step: number;
  company_id?: string | null; member_id?: string | null; group_id?: string | null;
  company_name: string; dart_corp_code: string | null; source_ref?: string | null;
  created_at: string; completed_at: string | null; latest_version: number | null;
  rerun_in_progress?: number;
  error_message?: string | null;
  target_type?: "affiliate" | "group" | null;
  member_name?: string | null; group_name?: string | null;
  opportunity_id?: string | null; opportunity_name?: string | null;
  versions?: Array<{ version_no: number; payload: SynergyPayload | null; changelog: string | null; created_by: string; created_at: string }>;
}


  // 필요 역량 수준 (S3, flow.spec v2.4.0 — 기존 "역량 갭"의 표시 명칭 변경,
  // 2026-09-15 S2 기회 상세 탭에서 이곳 연계 시너지 탭으로 이전) — 시너지
  // 영역 도출 다음에 필요 역량·보유 수준을 같은 흐름에서 기록한다. 데이터와
  // API(/api/opportunities/{id}/capability-gap)는 그대로 — 기회 단위 레지스터.
  export interface GapGetResponse {
    opportunity: { id: string; name: string };
    rows: CapabilityGapRow[];
    stored: boolean;
    sketchCapabilities: string[];
    internalAssessmentPending: boolean;
    internalAssessmentNote: string;
  }
