// @version 1.0.0
/** Request-body parsing for analyst-supplied profile evidence (ADR-0172 amendment 2026-10-15 (4)). */
import { badRequest } from "./envelope.ts";
import { MAX_NOTE_CHARS, MAX_USER_URLS, validateSourceUrls } from "./safe-fetch-text.ts";

export type ProfileEvidenceInput =
  | { ok: true; sourceUrls: string[]; companyNote: string }
  | { ok: false; response: Response };

export async function parseProfileEvidenceBody(request: Request): Promise<ProfileEvidenceInput> {
  let body: { sourceUrls?: unknown; companyNote?: unknown } = {};
  const text = await request.text().catch(() => "");
  if (text.trim()) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as typeof body;
      else return { ok: false, response: badRequest("invalid_body", "요청 본문은 JSON 객체여야 합니다.") };
    } catch {
      return { ok: false, response: badRequest("invalid_body", "요청 본문이 올바른 JSON이 아닙니다.") };
    }
  }
  if (body.sourceUrls !== undefined && !Array.isArray(body.sourceUrls)) {
    return { ok: false, response: badRequest("invalid_source_urls", "sourceUrls는 문자열 배열이어야 합니다.") };
  }
  if (body.companyNote !== undefined && typeof body.companyNote !== "string") {
    return { ok: false, response: badRequest("invalid_company_note", "companyNote는 문자열이어야 합니다.") };
  }
  const { urls, invalid, tooMany } = validateSourceUrls(body.sourceUrls);
  if (invalid.length > 0) {
    return { ok: false, response: badRequest("invalid_source_urls", `올바르지 않은 근거 주소(http/https, 포트 80/443, 인증정보 없음): ${invalid.join(", ")}`) };
  }
  if (tooMany) return { ok: false, response: badRequest("too_many_source_urls", `근거 주소는 최대 ${MAX_USER_URLS}개입니다.`) };
  const note = typeof body.companyNote === "string" ? body.companyNote.trim() : "";
  if (note.length > MAX_NOTE_CHARS) return { ok: false, response: badRequest("company_note_too_long", `회사 소개 메모는 ${MAX_NOTE_CHARS}자 이하여야 합니다.`) };
  return { ok: true, sourceUrls: urls, companyNote: note };
}
