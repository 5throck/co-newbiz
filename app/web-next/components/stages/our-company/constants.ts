// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import dynamic from "next/dynamic";
import type { CompetitiveCrossCheck, CrossCheckVerdict } from "./types.ts";

export const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

// Label-map constants store full catalog keys; components resolve them through
// a TranslatorFn at render (i18n/config.ts TranslatorFn doc).
export const PROFILE_TABS = [
  ["overview", "common.overview"],
  ["financials", "common.finance"],
  ["swot", "components.ourCompany.constants.strengthsAndWeaknessesSwot"],
  ["industry", "components.ourCompany.constants.industryLinkage"],
  ["competitive", "components.ourCompany.constants.competition"],
  ["sources", "components.ourCompany.constants.sourcesAndData"],
] as const;

export const CROSSCHECK_STATUS_META: Record<CompetitiveCrossCheck["status"], { label: string; chip: string }> = {
  cross_checked: { label: "components.ourCompany.constants.filingOriginalComparisonComplete", chip: "status-green" },
  dart_unavailable: { label: "components.ourCompany.constants.filingComparisonUnavailable", chip: "status-amber" },
  research_only: { label: "components.ourCompany.constants.researchComparisonOnlyUnlisted", chip: "status-in-progress" },
};
export const CROSSCHECK_VERDICT_META: Record<CrossCheckVerdict, { label: string; chip: string }> = {
  confirmed: { label: "common.confirm", chip: "status-green" },
  directional: { label: "components.ourCompany.constants.directionallyConsistent", chip: "status-in-progress" },
  contradicted: { label: "components.ourCompany.constants.conflicting", chip: "status-red" },
  unverified: { label: "components.ourCompany.constants.cannotVerify", chip: "status-amber" },
};

/** A profile analyzed more than this many days ago is flagged "stale" (re-analysis recommended). */
export const PROFILE_STALE_DAYS = 90;

// Copy for the 2026-10-11 /our-company refinement. Strings marked INTERIM-WORDING are new
// Korean wording pending human wording review; the rest reuses existing vocabulary.
// Values are catalog keys; resolve through a TranslatorFn at render
// (staleHint takes {p1} = PROFILE_STALE_DAYS).
export const OUR_COMPANY_COPY = {
  // INTERIM-WORDING
  s3Lead: "components.ourCompany.constants.thisProfileIsAnInput",
  // INTERIM-WORDING
  howUsedSummary: "components.ourCompany.constants.howItIsUsed",
  howUsedBody: "components.ourCompany.constants.usedAsOurCapabilityAnd",
  // INTERIM-WORDING
  groupMore: "components.ourCompany.constants.moreGroupActions",
  groupEdit: "components.ourCompany.constants.editGroupName",
  groupDelete: "components.ourCompany.constants.deleteGroup",
  // INTERIM-WORDING
  notAnalyzedYet: "components.ourCompany.constants.notYetAnalyzed",
  // INTERIM-WORDING
  rowMore: "components.ourCompany.constants.moreActions",
  // INTERIM-WORDING
  stale: "components.ourCompany.constants.stale",
  // INTERIM-WORDING
  staleHint: "components.ourCompany.constants.overP1DaysSinceAnalysis",
  // INTERIM-WORDING
  groupLoading: "components.ourCompany.constants.loadingGroups",
} as const;

/** Affiliate table column shares in percent (name, role, DART code, status, date, actions); must sum to 100 so every column scales together. */
export const MEMBER_COL_PCT = [24, 12, 14, 18, 14, 18] as const;
/** Confirmed-competitor table column shares in percent (name, DART code, relation, source, cross-check, actions); sums to 100. */
export const COMPETITOR_COL_PCT = [18, 12, 24, 16, 14, 16] as const;
