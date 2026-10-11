// Pure helper: validates CO_NEWBIZ_PUBLIC_ORIGIN for the production boot
// warning (instrumentation.ts). No app imports; never throws; returns
// warning strings only. Only the origin value itself is ever echoed.

export const PUBLIC_ORIGIN_ENV_KEY = "CO_NEWBIZ_PUBLIC_ORIGIN";

export function checkPublicOrigin(env: Record<string, string | undefined> = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const raw = env[PUBLIC_ORIGIN_ENV_KEY]?.trim() ?? "";
  if (!raw) {
    return [
      `${PUBLIC_ORIGIN_ENV_KEY} is not set. The OAuth issuer and MCP resource identifier are then derived from the request Host header, which a spoofed Host can change. Set ${PUBLIC_ORIGIN_ENV_KEY}=https://<public-host> in .env.prod and recreate the container (docker compose up -d --force-recreate).`,
    ];
  }
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    url = undefined;
  }
  const valid =
    !!url &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    /^https?:\/\/[^/?#]/i.test(raw) &&
    (url.pathname === "/" || url.pathname === "") &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password;
  if (valid) return [];
  return [
    `${PUBLIC_ORIGIN_ENV_KEY}="${raw}" is not a valid http(s) origin. Use scheme and host only (optionally a port), with no path, query or credentials, e.g. https://newbiz.bizknights.org.`,
  ];
}
