// Reserved brand names for unverified DCR clients (ADR-0203 Decision 5).
// Registration is anonymous, so a client_name such as "ChatGPT" would
// otherwise be shown on the consent screen as that brand to an impersonator.
// A name containing a reserved brand is accepted only when EVERY redirect_uri
// host is (a subdomain of) one of that brand's own hosts; loopback http hosts
// do not count. Matching is case-insensitive on the lowercased name and on the
// name with non-alphanumerics removed ("Co Newbiz" -> "conewbiz").

interface Brand {
  tokens: string[];
  hosts: string[];
}

const BRANDS: Brand[] = [
  { tokens: ["chatgpt", "openai"], hosts: ["chatgpt.com", "openai.com"] },
  { tokens: ["claude", "anthropic"], hosts: ["claude.ai", "claude.com", "anthropic.com"] },
  { tokens: ["gemini"], hosts: ["gemini.google.com", "google.com"] },
  // co-newbiz: only the app's own public origin host (appended at call time).
  { tokens: ["newbiz"], hosts: [] },
];

function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

/** True when `name` carries a reserved brand but a redirect host is not that brand's. */
export function violatesReservedName(name: unknown, redirectUris: unknown, publicHost: string): boolean {
  if (typeof name !== "string") return false;
  const lower = name.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  const matched = BRANDS.filter((b) => b.tokens.some((t) => lower.includes(t) || compact.includes(t)));
  if (matched.length === 0) return false;
  const hosts: string[] = [];
  if (Array.isArray(redirectUris)) {
    for (const u of redirectUris) {
      if (typeof u !== "string" || !URL.canParse(u)) continue;
      const url = new URL(u);
      // Loopback http never proves brand ownership; "https" hosts only.
      hosts.push(url.protocol === "https:" ? url.hostname.toLowerCase() : "");
    }
  }
  if (hosts.length === 0) return true;
  const own = publicHost.toLowerCase();
  return matched.some((b) => {
    const allowed = b.tokens.includes("newbiz") ? (own ? [own] : []) : b.hosts;
    return hosts.some((h) => h === "" || !allowed.some((a) => hostMatches(h, a)));
  });
}
