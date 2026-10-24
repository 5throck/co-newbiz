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
      else return { ok: false, response: badRequest("invalid_body", "Request body must be a JSON object.") };
    } catch {
      return { ok: false, response: badRequest("invalid_body", "Request body is not valid JSON.") };
    }
  }
  if (body.sourceUrls !== undefined && !Array.isArray(body.sourceUrls)) {
    return { ok: false, response: badRequest("invalid_source_urls", "sourceUrls must be an array of strings.") };
  }
  if (body.companyNote !== undefined && typeof body.companyNote !== "string") {
    return { ok: false, response: badRequest("invalid_company_note", "companyNote must be a string.") };
  }
  const { urls, invalid, tooMany } = validateSourceUrls(body.sourceUrls);
  if (invalid.length > 0) {
    return { ok: false, response: badRequest("invalid_source_urls", `Invalid evidence URLs (http/https, ports 80/443, no credentials): ${invalid.join(", ")}`) };
  }
  if (tooMany) return { ok: false, response: badRequest("too_many_source_urls", `At most ${MAX_USER_URLS} evidence URLs are allowed.`) };
  const note = typeof body.companyNote === "string" ? body.companyNote.trim() : "";
  if (note.length > MAX_NOTE_CHARS) return { ok: false, response: badRequest("company_note_too_long", `The company note must be at most ${MAX_NOTE_CHARS} characters.`) };
  return { ok: true, sourceUrls: urls, companyNote: note };
}
