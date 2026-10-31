// @version 1.0.0
/**
 * Webhook transport for notification delivery (ADR-0189/0190, scheduled-jobs design sections 13.1/13.8, phase P3 row 2).
 *
 * Slack ({text, blocks}) and Teams (message envelope + MessageCard/Adaptive attachment) JSON formatters, an
 * SSRF host allow-list (hooks.slack.com, *.webhook.office.com plus NOTIFY_WEBHOOK_ALLOWED_HOSTS extras) and a
 * fetch-based sender. Target URLs are bearer secrets: they live only in env (NOTIFY_WEBHOOK_URL_<CHANNEL>);
 * admin config (notify_webhook_target) stores the env-var NAME, never the URL — so any error message that could
 * carry the URL gets it redacted first (replaced with the env-var name or a [REDACTED_WEBHOOK_URL] placeholder).
 *
 * Layering (design section 5): imports only node/bun builtins and sibling db/lib modules — never scripts/ or app/web-next/lib.
 * MNPI: formatSlack/formatTeams accept ONLY NotifyView (see its contract in ./email.ts).
 */
import { scrubSecrets } from "../secret-scrubber.ts";
import type { NotifyView } from "./email.ts";
export type { NotifyView };

export type WebhookErrorCode =
  | "invalid_url" // unparseable target URL
  | "disallowed_host" // host not on the allow-list (SSRF guard, design section 13.8)
  | "insecure_scheme" // non-https target outside the explicit dev exception
  | "aborted" // caller AbortSignal fired
  | "timeout" // send exceeded the timeout budget (default 10 s, design section 13.1)
  | "http_retryable" // HTTP 408/429/5xx (design section 13.2: retry)
  | "http_terminal" // other HTTP 4xx (design section 13.2: no retry)
  | "network"; // fetch-level failure (DNS, refused, reset) — treated as transient

/** Typed webhook error. The target URL never appears in `message` — redacted in the constructor. */
export class WebhookError extends Error {
  readonly code: WebhookErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(
    code: WebhookErrorCode,
    rawMessage: string,
    opts: { url?: string; urlLabel?: string; status?: number; retryAfterMs?: number | null; cause?: unknown } = {},
  ) {
    // Redact the full target URL first (it embeds bearer tokens), then run the central scrubber for anything else.
    // Every message carries the env-var NAME (never the URL) so the delivery worker can attribute the failure.
    let msg = `${code}: ${rawMessage}${opts.urlLabel ? ` (target ${opts.urlLabel})` : ""}`;
    if (opts.url) msg = redactUrl(msg, opts.url, opts.urlLabel);
    super(scrubWebhookMessage(msg));
    this.name = "WebhookError";
    this.code = code;
    this.status = opts.status ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.retryable = code === "http_retryable" || code === "timeout" || code === "network";
  }
}

function scrubWebhookMessage(msg: string): string {
  return scrubSecrets(msg);
}

/** Replace every (plain and URL-encoded) occurrence of `url` in `msg` with `label ?? "[REDACTED_WEBHOOK_URL]"`. */
export function redactUrl(msg: string, url: string, label?: string): string {
  const placeholder = label ?? "[REDACTED_WEBHOOK_URL]";
  let out = msg;
  const trimmed = url.trim();
  if (trimmed) {
    out = out.split(trimmed).join(placeholder);
    const enc = encodeURIComponent(trimmed);
    if (enc !== trimmed) out = out.split(enc).join(placeholder);
  }
  return out;
}

/** resolveSchedulerEnv() equivalent, duplicated from scripts/ (layering rule — same as db/lib/notify/email.ts). */
function schedulerEnv(env: Record<string, string | undefined>): "prod" | "dev" | null {
  const raw = env.CO_NEWBIZ_SCHEDULER_ENV;
  return raw === "prod" || raw === "dev" ? raw : null;
}

const BUILTIN_ALLOWED_HOSTS = ["hooks.slack.com", "*.webhook.office.com"];

function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase().trim();
  if (!p) return false;
  // "*.webhook.office.com" style: subdomains only, plus the bare domain itself.
  if (p.startsWith("*.")) return h === p.slice(2) || h.endsWith(p.slice(1));
  return h === p;
}

/**
 * SSRF allow-list (design section 13.8): hooks.slack.com, *.webhook.office.com and the extra hosts parsed from
 * env NOTIFY_WEBHOOK_ALLOWED_HOSTS (comma-separated; entries may use the `*.domain.tld` subdomain wildcard).
 * Host-only check — the scheme rule lives in isSchemeAllowed.
 */
export function isHostAllowed(url: URL, env: Record<string, string | undefined> = process.env): boolean {
  const extras = (env.NOTIFY_WEBHOOK_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const patterns = [...BUILTIN_ALLOWED_HOSTS, ...extras];
  return patterns.some((p) => hostMatches(url.hostname, p));
}

/**
 * Scheme rule: https always. http is accepted ONLY when CO_NEWBIZ_SCHEDULER_ENV is explicitly "dev" — local
 * stub servers for development. Unset/garbage env values fail closed (https required); "prod" always requires
 * https. Never relax the unset case: a forgotten env var must not silently enable cleartext exfil paths.
 */
export function isSchemeAllowed(url: URL, env: Record<string, string | undefined> = process.env): boolean {
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return schedulerEnv(env) === "dev";
  return false;
}

/**
 * Resolve a webhook target URL from env by NAME. Returns null when unset/empty — the channel is disabled
 * (deliveries are recorded `skipped: channel_unconfigured`, design section 13.1), not an error.
 */
export function resolveTargetUrl(
  envVarName: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const v = env[envVarName]?.trim();
  return v ? v : null;
}

/** Default send budget (design section 13.1: 10 s timeout). */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Parse a Retry-After header value (delay-seconds or HTTP-date) into milliseconds; null when absent/invalid. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const s = value.trim();
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10) * 1000;
  const d = Date.parse(s);
  return Number.isFinite(d) ? Math.max(0, d - now) : null;
}

/**
 * POST one webhook message. Enforces the allow-list + scheme rules itself (the transport boundary is the
 * enforcement point — callers cannot forget). Redirects are never followed (`redirect: "manual"`, 3xx is a
 * terminal error) so a redirecting allowed host cannot bypass the SSRF guard. Resolves with `{ ok, status, providerMessageId, retryAfterMs }`
 * for 2xx responses; throws WebhookError otherwise, carrying `.status` and `.retryAfterMs` so the delivery
 * worker (Row 3) can honour Retry-After and the retry policy without re-parsing headers.
 *
 * `providerMessageId` is the id from the provider response when one is returned (Teams workflow responses
 * sometimes carry `id`); Slack incoming webhooks reply plain "ok", so it is commonly null.
 */
export async function sendWebhook(
  url: string,
  body: unknown,
  opts: {
    signal: AbortSignal;
    timeoutMs?: number /** env-var name to use as the redaction label in errors */;
    urlLabel?: string;
  },
): Promise<{ ok: boolean; status: number; providerMessageId: string | null; retryAfterMs: number | null }> {
  const timeoutMs = opts.timeoutMs ?? WEBHOOK_TIMEOUT_MS;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookError("invalid_url", `webhook target is not a valid URL (${opts.urlLabel ?? "target"})`, {
      url,
      urlLabel: opts.urlLabel,
    });
  }
  if (!isSchemeAllowed(parsed)) {
    throw new WebhookError("insecure_scheme", "webhook target must use https (http is dev-only)", {
      url,
      urlLabel: opts.urlLabel,
    });
  }
  if (!isHostAllowed(parsed)) {
    throw new WebhookError("disallowed_host", `webhook host ${parsed.hostname} is not allow-listed`, {
      url,
      urlLabel: opts.urlLabel,
    });
  }
  // Note: the allow-list rejection above intentionally echoes only the hostname, never the token-bearing URL.

  if (opts.signal?.aborted) throw new WebhookError("aborted", "aborted before fetch", { url, urlLabel: opts.urlLabel });

  const signals = [opts.signal, AbortSignal.timeout(timeoutMs)] as const;
  const signal = typeof AbortSignal.any === "function" ? AbortSignal.any([...signals]) : opts.signal;

  let res: Response;
  try {
    res = await fetch(parsed, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
      // SSRF: the allow-list covers only the configured target — fetch must never follow a 3xx off it
      // (a redirecting allowed host would otherwise exfiltrate the body to any URL, bypassing both the
      // host allow-list and the scheme rule). 3xx responses are refused below; the Location header is
      // deliberately not echoed (it can name an internal address).
      redirect: "manual",
    });
  } catch (err) {
    if (opts.signal.aborted) {
      throw new WebhookError("aborted", "aborted during fetch", { url, urlLabel: opts.urlLabel, cause: err });
    }
    // AbortSignal.timeout fired (or another fetch-level failure) — transient by policy (design section 13.2).
    throw new WebhookError("network", `webhook fetch failed: ${err instanceof Error ? err.message : String(err)}`, {
      url,
      urlLabel: opts.urlLabel,
      cause: err,
    });
  }

  const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));

  // Redirect refusal (SSRF, design section 13.8): a 3xx means the allowed host tried to move the POST
  // somewhere else — no in-scope provider (Slack incoming webhook / Teams workflow) redirects on success,
  // so this is always a refusal, terminal (no retry). The redirect target is never read or logged.
  if (res.status >= 300 && res.status < 400) {
    throw new WebhookError("http_terminal", `webhook redirect refused (HTTP ${res.status})`, {
      url,
      urlLabel: opts.urlLabel,
      status: res.status,
      retryAfterMs,
    });
  }

  const text = await res.text().catch(() => "");

  if (res.status >= 400) {
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    throw new WebhookError(
      retryable ? "http_retryable" : "http_terminal",
      `webhook responded HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      { url, urlLabel: opts.urlLabel, status: res.status, retryAfterMs },
    );
  }

  let providerMessageId: string | null = null;
  try {
    const json = JSON.parse(text) as { id?: unknown; messageId?: unknown };
    if (typeof json.id === "string") providerMessageId = json.id;
    else if (typeof json.messageId === "string") providerMessageId = json.messageId;
  } catch {
    // Plain-text bodies ("ok", "1") are normal for incoming webhooks — no id to record.
  }
  return { ok: res.ok, status: res.status, providerMessageId, retryAfterMs };
}

const SEVERITY_EMOJI: Record<NotifyView["severity"], string> = {
  opportunity: ":seedling:",
  warning: ":warning:",
  urgent: ":rotating_light:",
  info: ":information_source:",
  ops: ":gear:",
};

/**
 * Slack Incoming Webhook payload ({text, blocks}). ONLY NotifyView fields are rendered — the content rule
 * (MNPI, design section 13.1) forbids figures, valuations and document excerpts in webhook bodies.
 */
export function formatSlack(view: NotifyView): { text: string; blocks: unknown[] } {
  const emoji = SEVERITY_EMOJI[view.severity] ?? ":bell:";
  const project = [view.projectCode, view.projectName].filter(Boolean).join(" · ");
  const text = `${emoji} [co-newbiz] ${view.severity}: ${view.title}`;
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${view.title}`.slice(0, 150), emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*severity:* ${view.severity}\n*trigger:* ${view.triggerType}${project ? `\n*project:* ${project}` : ""}`,
      },
    },
  ];
  if (view.deepLink) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "Open in co-newbiz" }, url: view.deepLink }],
    });
  }
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "No figures or document content are included. The full payload is visible in the app only.",
      },
    ],
  });
  return { text, blocks };
}

/**
 * Microsoft Teams message payload for workflow webhooks: the `{"type":"message","attachments":[...]}` envelope
 * whose attachment carries an Adaptive Card (the shape Teams workflow/incoming endpoints accept under this
 * envelope; the legacy flat MessageCard POST is a different transport). ONLY NotifyView fields are rendered —
 * same MNPI content rule as formatSlack.
 */
export function formatTeams(view: NotifyView): { type: "message"; attachments: unknown[] } {
  const project = [view.projectCode, view.projectName].filter(Boolean).join(" · ");
  const facts: { title: string; value: string }[] = [
    { title: "Severity", value: view.severity },
    { title: "Trigger", value: view.triggerType },
  ];
  if (project) facts.push({ title: "Project", value: project });
  const body: unknown[] = [
    { type: "TextBlock", size: "Large", weight: "Bolder", text: view.title, wrap: true },
    {
      type: "FactSet",
      facts,
    },
    {
      type: "TextBlock",
      text: "No figures or document content are included. The full payload is visible in the app only.",
      isSubtle: true,
      size: "Small",
      wrap: true,
    },
  ];
  const actions: unknown[] = view.deepLink
    ? [{ type: "Action.OpenUrl", title: "Open in co-newbiz", url: view.deepLink }]
    : [];
  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body,
    ...(actions.length > 0 ? { actions } : {}),
  };
  return {
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }],
  };
}
