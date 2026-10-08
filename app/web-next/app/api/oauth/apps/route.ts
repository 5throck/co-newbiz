// Connected apps (MCP OAuth clients holding live tokens) for the session user — ADR-0154 §2.
import { getDb } from "../../../../../../db/client.ts";
import { listConnectedApps } from "../../../../../../db/lib/oauth.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  return ok(listConnectedApps(getDb(), auth.auth.userId, new Date().toISOString()));
}
