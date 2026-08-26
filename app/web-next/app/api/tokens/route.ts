// Port of app/server/tokens.ts GET/POST /api/tokens
import { getDb } from "../../../../../db/client.ts";
import { issueApiToken, listApiTokens } from "../../../../../db/lib/api-tokens.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, ok } from "../../../lib/envelope.ts";

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { label?: string; scopes?: string[] } | null;
  if (!body?.label?.trim()) {
    return badRequest("invalid_request", "label is required.");
  }
  try {
    const issued = issueApiToken(getDb(), {
      userId: auth.auth.userId,
      label: body.label.trim(),
      scopes: body.scopes && body.scopes.length > 0 ? body.scopes : ["read"],
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
