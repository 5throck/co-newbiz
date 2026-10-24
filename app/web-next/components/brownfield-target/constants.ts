// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
// i18n (design 2026-10-23-i18n-ui-adoption): label maps carry catalog keys —
// consumers resolve them at render through components.brownfieldTarget.constants.
import type { TargetDetail, EvalItem } from "./types.ts";

export const STATUS_KEY: Record<TargetDetail["status"], string> = { pending: "statusPending", shortlisted: "statusShortlisted", excluded: "statusExcluded" };
export const EVAL_VERDICTS = ["pass", "partial", "fail", "na", "waived"] as const;
export const VERDICT_KEY: Record<string, string> = { pass: "verdictPass", partial: "verdictPartial", fail: "verdictFail", na: "verdictNa", waived: "verdictWaived", pending: "verdictPending" };
export const EVAL_CATEGORY_KEY: Record<EvalItem["category"], string> = { financial: "catFinancial", technical: "catTechnical" };
export const PROFILE_TABS: Array<["overview" | "aiprofile" | "financials" | "disclosures" | "precheck" | "eval" | "sources", string]> = [
  ["overview", "tabOverview"],
  ["aiprofile", "tabAiProfile"],
  ["financials", "tabFinancials"],
  ["disclosures", "tabDisclosures"],
  ["precheck", "tabPrecheck"],
  ["eval", "tabEval"],
  ["sources", "tabSources"],
];
