import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(/*turbopackIgnore: true*/ appRoot, "..", "..");

const nextConfig: NextConfig = {
  // Wave C-1: the E2E harness builds into its own dist dir so it never touches
  // the operator's dev (.next/dev) or production (.next) output.
  distDir: process.env.CO_NEWBIZ_DIST_DIR ?? ".next",
  // db/client.ts imports "bun:sqlite" — a Bun-runtime builtin. Route
  // Handlers under app/api/** must not be bundled for the Edge runtime
  // (which has no bun:sqlite); this config keeps them on the Node/Bun
  // server runtime, matching every route in this phase.
  serverExternalPackages: ["bun:sqlite", "playwright-core"],
  // Next/Turbopack can otherwise infer C:\git as the workspace root because
  // this workstation has parent-directory lockfiles. Scope the workspace to
  // the co-newbiz repository: wide enough for ../../db imports, narrow enough
  // to avoid tracing the whole checkout hierarchy.
  turbopack: { root: repoRoot },
  // Remote (IP) access: dev resources (/_next/webpack-hmr etc.) are blocked
  // cross-origin by default. List every host the operator browses dev from —
  // the Tailscale IP, the LAN IP of this workstation, and the public domain
  // served through the Cloudflare tunnel to this dev server (7749).
  // Wave U-1 (finding 5): the dev-only Next indicator defaults to bottom-left
  // and overlaps the sidebar footer. Anchor it bottom-right (clear of the
  // sidebar); production builds never render it. tests/unit/layout-fixed.test.ts
  // guards this together with the fixed-position CSS allowlist.
  devIndicators: { position: "bottom-right" },
  allowedDevOrigins: ["100.104.16.127", "192.168.0.44", "co-newbiz.bizknights.org"],
  // ADR-0154: the OAuth consent and connected-apps screens must never be
  // framed (clickjacking a consent "허용") and must not leak the query
  // (client_id/state/PKCE challenge) through Referer.
  async headers() {
    const hardened = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ];
    return [
      { source: "/oauth/:path*", headers: hardened },
      { source: "/settings/connected-apps", headers: hardened },
    ];
  },
};

export default nextConfig;
