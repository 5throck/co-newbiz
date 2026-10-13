// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import type { TargetDetail, EvalItem } from "./types.ts";

export const STATUS_LABEL: Record<TargetDetail["status"], string> = { pending: "심사 중", shortlisted: "최종 후보 목록", excluded: "제외" };
export const EVAL_VERDICTS = ["pass", "partial", "fail", "na", "waived"] as const;
export const VERDICT_KO: Record<string, string> = { pass: "충족", partial: "부분충족", fail: "미충족", na: "해당없음", waived: "예외", pending: "미판정" };
export const EVAL_CATEGORY_LABEL: Record<EvalItem["category"], string> = { financial: "재무적 평가", technical: "기술적 평가" };
export const PROFILE_TABS: Array<["overview" | "aiprofile" | "financials" | "disclosures" | "precheck" | "eval" | "sources", string]> = [
  ["overview", "개요"],
  ["aiprofile", "강·약점 SWOT"],
  ["financials", "재무"],
  ["disclosures", "공시"],
  ["precheck", "사전 검토 근거"],
  ["eval", "평가"],
  ["sources", "출처"],
];