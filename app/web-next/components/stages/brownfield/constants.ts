// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { EvalItem, TargetRow } from "./types.ts";

export const EVAL_CATEGORY_LABEL: Record<EvalItem["category"], string> = { financial: "재무적 평가", technical: "기술적 평가" };

export const STATUS_LABEL: Record<TargetRow["status"], string> = { pending: "심사 중", shortlisted: "Short List", excluded: "제외" };

// mockup baseline-v5.html의 S6/S7은 탭으로 나뉘지 않은 단일 연속 화면이다
// (Universe 정의 → 후보 발굴 → Long List(판정·랭킹·Short List) → 위원회 심의
// → 게이트, 전부 한 페이지). 탭을 없애고 흐름 배너는 섹션으로 스크롤 이동만
// 한다(사용자 요청, 2026-09-15).
export const SECTION_IDS = { universe: "s6s7-universe", longlist: "s6s7-longlist", shortlist: "s6s7-shortlist" } as const;