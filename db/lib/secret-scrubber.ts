// @version 1.0.0
/**
 * Secret scrubber (ADR-0189 / scheduled-jobs design section 5). Everything a scheduler run writes to `job_run.error`,
 * `detail_json`, stdout or stderr passes through here first. Redacts:
 *   - the VALUE of every secret-looking env var: names ending _KEY/_TOKEN/_SECRET/_PASSWORD/_PASS, DATABASE_URL, session
 *     secrets, webhook URLs, plus names registered by the scripts layer (registerCredentialEnvNames), length >= 6;
 *   - URL query parameters named key|crtfc_key|serviceKey|OC|apiKey|api_key|token|access_token|authKey;
 *   - `Authorization: Bearer ...` headers and `Bearer <token>` strings;
 *   - the password in `scheme://user:password@host` URLs.
 * Output is truncated to MAX_ERROR_LEN (2 KB) after scrubbing.
 *
 * Layering (design 5): this module imports nothing from scripts/. The adapter credential env names are injected by
 * scripts/co-newbiz/scheduler-core.ts via registerCredentialEnvNames().
 */
export const MAX_ERROR_LEN = 2048;
export const REDACTED = "[REDACTED]";

const EXTRA_SECRET_ENV = [
  "TAVILY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "SERPER_API_KEY",
  "NOTIFY_SMTP_PASS",
  "NOTIFY_WEBHOOK_URL_DEALS",
  "NOTIFY_WEBHOOK_URL_OPS",
];
const SECRET_ENV_PATTERN = /(_KEY|_TOKEN|_SECRET|_PASSWORD|_PASS)$|^(DATABASE_URL|SESSION_SECRET|NOTIFY_WEBHOOK_URL_.*)$/;
const INJECTED_ENV_NAMES = new Set<string>();

/** Called by the scripts layer with the adapters' credentialEnv names (keeps db/lib free of scripts/ imports). */
export function registerCredentialEnvNames(names: Iterable<string>): void {
  for (const n of names) if (n) INJECTED_ENV_NAMES.add(n);
}
const MIN_SECRET_LEN = 6;

/** Names of env vars whose values must never be written. */
export function secretEnvNames(env: Record<string, string | undefined> = process.env): string[] {
  const names = new Set<string>(EXTRA_SECRET_ENV);
  for (const n of INJECTED_ENV_NAMES) names.add(n);
  for (const k of Object.keys(env)) if (SECRET_ENV_PATTERN.test(k)) names.add(k);
  return [...names];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scrubSecrets(
  input: unknown,
  opts: { env?: Record<string, string | undefined>; extraSecrets?: string[]; maxLen?: number } = {},
): string {
  const env = opts.env ?? process.env;
  let s = input instanceof Error ? `${input.message}` : typeof input === "string" ? input : String(input ?? "");
  const values = new Set<string>(opts.extraSecrets ?? []);
  for (const name of secretEnvNames(env)) {
    const v = env[name];
    if (v) values.add(v);
  }
  // Longest first so a secret that contains another is replaced whole.
  for (const v of [...values].filter((x) => x.length >= MIN_SECRET_LEN).sort((a, b) => b.length - a.length)) {
    s = s.replace(new RegExp(escapeRe(v), "g"), REDACTED);
    // The URL-encoded form commonly appears in request URLs.
    const enc = encodeURIComponent(v);
    if (enc !== v) s = s.replace(new RegExp(escapeRe(enc), "g"), REDACTED);
  }
  s = s.replace(/([?&;](?:key|crtfc_key|serviceKey|OC|apiKey|api_key|token|access_token|authKey)=)[^&\s"'#]*/gi, `$1${REDACTED}`);
  s = s.replace(/(Authorization\s*:\s*\w+\s+)[^\s"']+/gi, `$1${REDACTED}`);
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${REDACTED}`);
  s = s.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi, `$1${REDACTED}$2`);
  const max = opts.maxLen ?? MAX_ERROR_LEN;
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

/** Scrub every string inside a JSON-like value (before it is stringified, so truncation can never cut a redaction). */
export function scrubDeep<T>(value: T, opts: Parameters<typeof scrubSecrets>[1] = {}): T {
  const o = { ...opts, maxLen: Number.MAX_SAFE_INTEGER };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrubSecrets(v, o);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** JSON for job_run.detail_json: scrubbed first, then size-capped; overflow stays VALID JSON with a short preview. */
export function safeDetailJson(detail: unknown, maxLen = 8192): string {
  const json = JSON.stringify(scrubDeep(detail));
  if (json.length <= maxLen) return json;
  return JSON.stringify({ truncated: true, preview: json.slice(0, 1000) });
}
