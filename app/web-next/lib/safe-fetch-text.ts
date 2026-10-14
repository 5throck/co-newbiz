// @version 1.0.0
/**
 * Analyst-supplied source fetcher for company profile generation (ADR-0172 amendment 2026-10-15 (4)).
 *
 * Fetches a user-given http/https URL and returns readable text. Everything it returns is UNTRUSTED DATA: the caller
 * must wrap it in delimiters and never let the model follow instructions found inside. Guards:
 *   - http/https only, ports 80/443 only, no embedded credentials;
 *   - DNS is resolved and every address re-checked against private / loopback / link-local / metadata ranges
 *     (scripts/lib/ssrf.ts validateUrl) on EVERY hop, and the socket is pinned to the validated addresses (no second lookup);
 *   - at most 3 redirects, each hop re-validated; 10 s total timeout; response size cap; content-type allowlist;
 *   - scripts, styles and tags are stripped, control characters removed, text capped per URL and in total.
 * Fetched bodies are never logged. Network and DNS are injectable so tests run without any network.
 */
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import { validateUrl, type SSRFValidationResult } from "../../../scripts/lib/ssrf.ts";

export const MAX_USER_URLS = 8;
export const MAX_NOTE_CHARS = 2000;
export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 1_500_000;
export const MAX_CHARS_PER_URL = 12_000;
export const MAX_CHARS_TOTAL = 40_000;
export const THIN_TEXT_CHARS = 400;
export const USER_AGENT = "co-newbiz-profile-fetcher/1.0 (+analyst-supplied source; read-only)";

const ALLOWED_TYPES = ["text/html", "text/plain", "application/xhtml+xml", "application/json"];

export type UserSourceStatus = "ok" | "thin" | "failed";
export interface UserSourceRecord {
  url: string;
  title?: string;
  /** True when a response body was read (ok or thin). */
  fetched: boolean;
  charCount: number;
  status: UserSourceStatus;
  /** Short Korean reason for thin / failed; never includes response content. */
  reason?: string;
  /** Always true for analyst-supplied entries (fetched URL or hand-entered). */
  provided?: boolean;
  /** Hand-entered excerpt (출처 추가) — editable/removable by an analyst, never a pipeline-collected source. */
  manual?: boolean;
  id?: string;
  addedBy?: string;
  addedAt?: string;
  /** Pasted excerpt/summary of a manual entry (<= 4000 chars). */
  excerpt?: string;
  /** Soft-removed: the slot is kept so [Un] numbers in stored text never shift. */
  removed?: boolean;
}
/** Record plus the extracted text, which is transient (used for the prompt, never persisted). */
export interface FetchedUserSource extends UserSourceRecord { text: string }

export interface TransportResponse { status: number; headers: Record<string, string>; body: Uint8Array }
export type Transport = (
  url: string,
  pinnedAddresses: string[],
  opts: { signal: AbortSignal; headers: Record<string, string>; maxBytes: number },
) => Promise<TransportResponse>;
export interface SafeFetchDeps {
  validate?: (url: string) => Promise<SSRFValidationResult>;
  transport?: Transport;
  timeoutMs?: number;
}

/** Validation of the request-supplied list; returns the bad entries so the route can name them. */
export function validateSourceUrls(raw: unknown): { urls: string[]; invalid: string[]; tooMany: boolean } {
  const list = Array.isArray(raw) ? raw : [];
  const urls: string[] = [];
  const invalid: string[] = [];
  for (const item of list) {
    const s = typeof item === "string" ? item.trim() : "";
    if (!s) continue;
    if (!isAllowedUrlShape(s)) { invalid.push(s.slice(0, 200)); continue; }
    if (!urls.includes(s)) urls.push(s);
  }
  return { urls, invalid, tooMany: urls.length > MAX_USER_URLS };
}

/** Static shape check (no DNS): http/https, no credentials, port 80/443 only. */
export function isAllowedUrlShape(s: string): boolean {
  let u: URL;
  try { u = new URL(s); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  return true;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => { const c = Number(n); return c > 31 && c < 0x10ffff ? String.fromCodePoint(c) : " "; })
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => { const c = parseInt(h, 16); return c > 31 && c < 0x10ffff ? String.fromCodePoint(c) : " "; })
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Removes control characters (keeps \n and \t), zero-width and bidi override characters. */
export function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
}

export function htmlToReadableText(html: string): { title?: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim().slice(0, 200) : undefined;
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  const cleaned = stripControlChars(decodeEntities(text))
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title || undefined, text: cleaned };
}

/** Default pinned transport: http(s).request with a lookup that only returns the validated addresses; streams with a byte cap. */
export const defaultTransport: Transport = (targetUrl, pinned, { signal, headers, maxBytes }) => {
  const parsed = new URL(targetUrl);
  const isHttps = parsed.protocol === "https:";
  const requestFn = isHttps ? https.request : http.request;
  const lookup = ((_h: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    const results = pinned.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 }));
    if (options?.all) cb(null, results); else cb(null, results[0].address, results[0].family);
  }) as unknown as net.LookupFunction;
  return new Promise<TransportResponse>((resolve, reject) => {
    const req = requestFn(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        lookup,
        headers,
        ...(isHttps ? { servername: parsed.hostname } : {}),
      },
      (res) => {
        const outHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) outHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) { res.resume(); resolve({ status, headers: outHeaders, body: new Uint8Array() }); return; }
        const declared = Number(outHeaders["content-length"] ?? 0);
        if (declared > maxBytes) { res.destroy(); reject(new Error("too_large")); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) { res.destroy(); reject(new Error("too_large")); return; }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status, headers: outHeaders, body: new Uint8Array(Buffer.concat(chunks)) }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    const abort = () => { req.destroy(); reject(new Error("timeout")); };
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    req.end();
  });
};

class SourceError extends Error {}

function failed(url: string, reason: string): FetchedUserSource {
  return { url, fetched: false, charCount: 0, status: "failed", reason, text: "" };
}

/** Fetches one URL. Never throws; failures come back as status "failed" with a short reason. */
export async function fetchUserSourceText(url: string, deps: SafeFetchDeps = {}): Promise<FetchedUserSource> {
  const validate = deps.validate ?? validateUrl;
  const transport = deps.transport ?? defaultTransport;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isAllowedUrlShape(current)) throw new SourceError("허용되지 않는 주소(http/https, 포트 80/443만)");
      const check = await validate(current);
      if (!check.allowed || !check.resolvedAddresses?.length) throw new SourceError(hop === 0 ? "내부망·차단 주소" : "리다이렉트 대상이 차단 주소");
      const res = await Promise.race([
        transport(current, check.resolvedAddresses, {
          signal: controller.signal,
          headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,application/xhtml+xml,application/json;q=0.9" },
          maxBytes: MAX_BODY_BYTES,
        }),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })),
      ]);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers["location"];
        if (!loc) throw new SourceError("리다이렉트 위치 없음");
        if (hop === MAX_REDIRECTS) throw new SourceError("리다이렉트 3회 초과");
        current = new URL(loc, current).toString();
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new SourceError(`HTTP ${res.status}`);
      const type = (res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!ALLOWED_TYPES.includes(type)) throw new SourceError(`지원하지 않는 형식(${type || "알 수 없음"})`);
      if (res.body.length > MAX_BODY_BYTES) throw new SourceError("응답이 너무 큼");
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(res.body);
      const { title, text: extracted } = type === "text/plain" || type === "application/json"
        ? { title: undefined, text: stripControlChars(raw).replace(/[ \t\r]+/g, " ").trim() }
        : htmlToReadableText(raw);
      const text = extracted.slice(0, MAX_CHARS_PER_URL);
      const thin = text.length < THIN_TEXT_CHARS;
      return {
        url,
        title,
        fetched: true,
        charCount: text.length,
        status: thin ? "thin" : "ok",
        reason: thin ? "본문 부족(동적 페이지 등) — 출처 주소로만 기록" : undefined,
        text,
      };
    }
    throw new SourceError("리다이렉트 3회 초과");
  } catch (err) {
    if (err instanceof SourceError) return failed(url, err.message);
    const msg = err instanceof Error ? err.message : "";
    if (msg === "timeout" || controller.signal.aborted) return failed(url, "시간 초과(10초)");
    if (msg === "too_large") return failed(url, "응답이 너무 큼");
    return failed(url, "연결 실패");
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches all URLs (sequentially, bounded) and applies the total text budget. */
export async function fetchUserSources(urls: string[], deps: SafeFetchDeps = {}): Promise<FetchedUserSource[]> {
  const out: FetchedUserSource[] = [];
  let budget = MAX_CHARS_TOTAL;
  for (const url of urls.slice(0, MAX_USER_URLS)) {
    const r = await fetchUserSourceText(url, deps);
    if (r.text.length > budget) {
      r.text = r.text.slice(0, Math.max(0, budget));
      r.charCount = r.text.length;
      if (r.text.length < THIN_TEXT_CHARS && r.status === "ok") { r.status = "thin"; r.reason = "전체 분량 한도로 본문 일부만 사용"; }
    }
    budget -= r.text.length;
    out.push(r);
  }
  return out;
}

/** Strips delimiter look-alikes and control characters so supplied text cannot close the evidence block. */
export function sanitizeUntrusted(s: string): string {
  return stripControlChars(s).replace(/<<<|>>>/g, " ").replace(/USER_EVIDENCE/gi, "USER-EVIDENCE");
}

export function toRecord(s: FetchedUserSource): UserSourceRecord {
  const { text: _text, ...rec } = s;
  return rec;
}
