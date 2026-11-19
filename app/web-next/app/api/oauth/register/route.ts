// RFC 7591 dynamic client registration — ADR-0154 §2, design §4.2.
// Every registered client is PUBLIC: PKCE S256 is the only proof and no secret
// is ever issued. A request naming another token_endpoint_auth_method is
// accepted and registered as public; the response reports the value actually
// applied ("none"), as RFC 7591 §3.2.1 permits (ADR-0203). Clients start
// unverified; redirect URIs must be https or loopback http. When
// CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST is set (comma list of hosts), only
// those redirect hosts (plus loopback) may register.
// A client_name containing a reserved brand (ChatGPT/OpenAI, Claude/Anthropic,
// Gemini, co-newbiz) is accepted only when every redirect host belongs to that
// brand (ADR-0203 Decision 5); otherwise reason `reserved_client_name`.
// Every refusal (400/429) writes one `oauth_dcr_refused` audit row carrying a
// reason code, never the request body (design §3).
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { OAUTH_SCOPES, registerClient } from "../../../../../../db/lib/oauth.ts";
import { oauthError, oauthJson, publicOrigin } from "../../../../lib/mcp/config.ts";
import { violatesReservedName } from "../../../../lib/mcp/reserved-client-names.ts";
import { preflight, withCors } from "../../../../lib/mcp/cors.ts";
import {
  cfRay,
  clientIp,
  clientRequestId,
  ipHash,
  rateCheck,
  rateKey,
  requestId,
  withRequestId,
} from "../../../../lib/mcp/request-meta.ts";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const MAX_KEYS = 50_000;
const GLOBAL_MAX_PER_WINDOW = 200;
const KEY = Symbol.for("co-newbiz.oauth.dcrHits");
const LOGGED_KEY = Symbol.for("co-newbiz.oauth.dcrRateLogged");
const GLOBAL_KEY = Symbol.for("co-newbiz.oauth.dcrGlobalRegistrations");
type Holder = { [KEY]?: Map<string, number[]>; [LOGGED_KEY]?: Map<string, number>; [GLOBAL_KEY]?: number[] };
const holder = globalThis as Holder;
// Successful registrations across all callers: a ceiling that rotating IPs cannot bypass.
if (!holder[GLOBAL_KEY]) holder[GLOBAL_KEY] = [];
const globalRegs = holder[GLOBAL_KEY] as number[];
if (!holder[KEY]) holder[KEY] = new Map<string, number[]>();
const hits = holder[KEY] as Map<string, number[]>;
// One rate_limited audit row per IP per window, so a flood cannot amplify the log.
if (!holder[LOGGED_KEY]) holder[LOGGED_KEY] = new Map<string, number>();
const rateLogged = holder[LOGGED_KEY] as Map<string, number>;

function hostAllowed(uri: string): boolean {
  const list = (process.env.CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return true;
  const host = new URL(uri).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || list.includes(host);
}

interface Ctx {
  rid: string;
  clientRid: string | null;
  ip: string;
  ray: string | null;
}

function log(ctx: Ctx, status: number, reason: string): void {
  const h = ipHash(ctx.ip);
  console.info(
    JSON.stringify({ event: "oauth_dcr", status, reason, request_id: ctx.rid, ...(h ? { ip_hash: h } : {}) }),
  );
}

/** Audit one refusal: reason code + metadata only — no body, name, URIs or tokens. */
function refuse(
  ctx: Ctx,
  reason: string,
  status: number,
  error: string,
  description: string,
  extra: Record<string, string> = {},
): Response {
  try {
    appendAudit(getDb(), {
      actor: "anonymous",
      action: "oauth_dcr_refused",
      target: JSON.stringify({
        reason,
        status,
        ...(ipHash(ctx.ip) ? { ip_hash: ipHash(ctx.ip) } : {}),
        request_id: ctx.rid,
        client_request_id: ctx.clientRid,
        cf_ray: ctx.ray,
        ...extra,
      }),
      now: new Date().toISOString(),
    });
  } catch {
    /* the audit must not turn a refusal into a 500 */
  }
  log(ctx, status, reason);
  return withRequestId(withCors(oauthError(error, description, status)), ctx.rid);
}

function appliedScope(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const known = value.split(/\s+/).filter((s) => (OAUTH_SCOPES as readonly string[]).includes(s));
  const unique = [...new Set(known)];
  return unique.length > 0 ? unique.join(" ") : undefined;
}

export async function POST(request: Request) {
  const now = Date.now();
  const ctx: Ctx = {
    rid: requestId(request),
    clientRid: clientRequestId(request),
    ip: clientIp(request),
    ray: cfRay(request),
  };
  const check = rateCheck(hits, rateKey(ctx.ip), now, { windowMs: WINDOW_MS, max: MAX_PER_WINDOW, maxKeys: MAX_KEYS });
  if (check.limited) {
    // One rate_limited audit row per bucket per window; the log map is pruned and capped.
    if (rateLogged.size >= MAX_KEYS) {
      for (const [k, t] of rateLogged) if (now - t >= WINDOW_MS) rateLogged.delete(k);
    }
    const loggedAt = rateLogged.get(check.key);
    if (loggedAt === undefined || now - loggedAt >= WINDOW_MS) {
      if (rateLogged.size < MAX_KEYS || loggedAt !== undefined) rateLogged.set(check.key, now);
      return refuse(ctx, "rate_limited", 429, "invalid_request", "Too many registrations; retry later.");
    }
    return withRequestId(withCors(oauthError("invalid_request", "Too many registrations; retry later.", 429)), ctx.rid);
  }
  while (globalRegs.length > 0 && now - globalRegs[0] >= WINDOW_MS) globalRegs.shift();
  if (globalRegs.length >= GLOBAL_MAX_PER_WINDOW) {
    return refuse(ctx, "global_rate_limited", 429, "invalid_request", "Too many registrations; retry later.");
  }

  const parsed: unknown = await request.json().catch(() => undefined);
  if (parsed === undefined) return refuse(ctx, "body_not_json", 400, "invalid_client_metadata", "JSON body required.");
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return refuse(ctx, "body_not_object", 400, "invalid_client_metadata", "Request body must be a JSON object.");
  }
  // Unknown fields (client_uri, logo_uri, contacts, software_id, ...) are accepted and ignored.
  const body = parsed as Record<string, unknown>;

  const responseTypes = body.response_types;
  if (
    responseTypes !== undefined &&
    (!Array.isArray(responseTypes) || responseTypes.length === 0 || responseTypes.some((r) => r !== "code"))
  ) {
    return refuse(
      ctx,
      "response_type_unsupported",
      400,
      "invalid_client_metadata",
      'Only response_types ["code"] is supported.',
    );
  }
  const grants = body.grant_types === undefined ? ["authorization_code", "refresh_token"] : body.grant_types;
  if (
    !Array.isArray(grants) ||
    !grants.includes("authorization_code") ||
    grants.some((g) => g !== "authorization_code" && g !== "refresh_token")
  ) {
    return refuse(
      ctx,
      "grant_unsupported",
      400,
      "invalid_client_metadata",
      "Only authorization_code and refresh_token grants are supported.",
    );
  }
  const uris = body.redirect_uris;
  if (Array.isArray(uris)) {
    const blocked = uris.find((u) => typeof u === "string" && URL.canParse(u) && !hostAllowed(u));
    if (typeof blocked === "string") {
      return refuse(
        ctx,
        "redirect_host_not_allowed",
        400,
        "invalid_redirect_uri",
        "Redirect host is not on the administrator allowlist.",
        {
          redirect_host: new URL(blocked).hostname.slice(0, 253),
        },
      );
    }
  }
  if (violatesReservedName(body.client_name, uris, new URL(publicOrigin(request)).hostname)) {
    return refuse(
      ctx,
      "reserved_client_name",
      400,
      "invalid_client_metadata",
      "client_name uses a reserved brand name that does not match the redirect URI hosts.",
    );
  }
  const res = registerClient(getDb(), { name: body.client_name, redirectUris: uris, now: new Date().toISOString() });
  if (!res.ok) return refuse(ctx, res.error, 400, res.error, res.description);

  globalRegs.push(now);
  log(ctx, 201, "registered");
  const scope = appliedScope(body.scope);
  return withRequestId(
    withCors(
      oauthJson(
        {
          client_id: res.client.client_id,
          client_id_issued_at: Math.floor(Date.parse(res.client.created_at) / 1000),
          client_name: res.client.name,
          redirect_uris: res.client.redirect_uris,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          ...(scope ? { scope } : {}),
        },
        201,
      ),
    ),
    ctx.rid,
  );
}

export async function OPTIONS() {
  return preflight();
}
