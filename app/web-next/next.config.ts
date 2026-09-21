import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(/*turbopackIgnore: true*/ appRoot, "..", "..");

const nextConfig: NextConfig = {
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
  // Tailscale IP and the LAN IP of this workstation.
  allowedDevOrigins: ["100.104.16.127", "192.168.0.44"],
};

export default nextConfig;
