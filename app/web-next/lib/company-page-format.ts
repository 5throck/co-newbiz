// @version 1.0.0
// Pure helpers for /companies/[companyId]: WACC reference value/date formatting
// and sync error/success guidance. No React, no Date parsing of as_of.

export interface SyncGuidance { title: string; hint: string }

const BY_CODE: Record<string, SyncGuidance> = {
  dart_not_configured: { title: "DART 연동이 설정되지 않았습니다", hint: "관리자에게 DART API 키 설정을 요청하세요." },
  corp_code_unresolved: { title: "DART 고유번호(corp code)를 찾지 못했습니다", hint: "회사명·법인 정보를 확인하거나 관리자에게 고유번호 등록을 요청하세요." },
  dart_retrieval_failed: { title: "DART에서 재무정보를 가져오지 못했습니다", hint: "잠시 후 다시 시도하세요." },
  company_not_found: { title: "회사를 찾을 수 없습니다", hint: "회사 목록에서 다시 선택하세요." },
  forbidden: { title: "동기화 권한이 없습니다", hint: "업무 쓰기 권한이 있는 담당자에게 요청하세요." },
  unauthorized: { title: "로그인이 필요합니다", hint: "다시 로그인한 뒤 시도하세요." },
};

/** Map by envelope code first, then by message substring; append the server message. */
export function mapSyncError(status: number | null, code: string | null, message: string): string {
  let g: SyncGuidance | undefined = code ? BY_CODE[code] : undefined;
  if (!g && /DART_HTML_BLOCKED/.test(message)) g = { title: "DART가 일시적으로 접속을 차단했습니다", hint: "잠시 후 다시 시도하세요." };
  if (!g && /DART_RATE_LIMITED/.test(message)) g = { title: "DART 요청 한도를 초과했습니다", hint: "시간을 두고 나중에 다시 시도하세요." };
  if (!g && (status === 403 || status === 401)) g = BY_CODE[status === 403 ? "forbidden" : "unauthorized"];
  if (!g && status === 404) g = BY_CODE.company_not_found;
  const detail = message ? ` (서버 메시지: ${message})` : "";
  return g ? `${g.title} — ${g.hint}${detail}` : `동기화에 실패했습니다${detail}`;
}

export function syncSuccessMessage(s: { inserted: number; unchanged: number; years: number[] }): string {
  const yrs = s.years.length ? ` (${s.years.join(", ")}년)` : "";
  if (s.inserted === 0) {
    return `동기화 완료 — 신규 0건 · 변경 없음 ${s.unchanged}건${yrs}. DART 값이 저장된 값과 동일하여 마지막 동기화 날짜는 바뀌지 않습니다.`;
  }
  return `동기화 완료 — 신규 ${s.inserted}건 · 변경 없음 ${s.unchanged}건${yrs}`;
}

/** ratio -> "2.85%"; multiple -> "0.85x"; null -> "N/A" (never 0). */
export function formatWaccValue(value: number | null, unit: "ratio" | "multiple"): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return unit === "ratio" ? `${(value * 100).toFixed(2)}%` : `${value.toFixed(2)}x`;
}

/** "2026-09" / "2026-09-30" -> "2026년 9월 기준"; "2025" -> "2025 회계연도 기준"; else raw. */
export function formatAsOfLabel(asOf: string | null): string | null {
  if (!asOf) return null;
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(asOf);
  if (m) return `${m[1]}년 ${Number(m[2])}월 기준`;
  if (/^\d{4}$/.test(asOf)) return `${asOf} 회계연도 기준`;
  return `${asOf} 기준`;
}
