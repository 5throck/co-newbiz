// Port of app/server/tokens.ts GET/POST /api/tokens
import { getDb } from "../../../../../db/client.ts";
import { issueApiToken, listApiTokens } from "../../../../../db/lib/api-tokens.ts";
import { authenticate, ADMIN_BUSINESS_FORBIDDEN_MESSAGE } from "../../../lib/auth.ts";
import { badRequest, forbidden, ok } from "../../../lib/envelope.ts";

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { label?: string; scopes?: string[] } | null;
  if (!body?.label?.trim()) {
    return badRequest("invalid_request", "label is required.");
  }
  const scopes = body.scopes && body.scopes.length > 0 ? body.scopes : ["read"];
  // Viewer-role accounts are read-only everywhere else (per-route role gates);
  // issuing them a write-scoped bearer token would bypass those gates.
  if (scopes.includes("write") && auth.auth.role === "viewer") {
    return forbidden("role_required", "viewer 계정은 write 스코프 토큰을 발급할 수 없습니다.");
  }
  // ADR-0146: admin accounts may not issue write-scoped tokens (business-content write access).
  if (scopes.includes("write") && auth.auth.role === "admin") {
    return forbidden("role_forbidden", ADMIN_BUSINESS_FORBIDDEN_MESSAGE);
  }
  try {
    const issued = issueApiToken(getDb(), {
      userId: auth.auth.userId,
      label: body.label.trim(),
      scopes,
      now: new Date().toISOString(),
    });
    return ok({ token: issued.token, id: issued.id, label: body.label.trim() }, 201, { note: "Store this token now — it is never shown again." });
  } catch (err) {
    return badRequest("token_issue_failed", err instanceof Error ? err.message : "Token issue failed.");
  }
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  return ok(listApiTokens(getDb(), auth.auth.userId));
}
