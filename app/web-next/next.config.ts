import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // db/client.ts imports "bun:sqlite" — a Bun-runtime builtin. Route
  // Handlers under app/api/** must not be bundled for the Edge runtime
  // (which has no bun:sqlite); this config keeps them on the Node/Bun
  // server runtime, matching every route in this phase.
  serverExternalPackages: ["bun:sqlite"],
};

export default nextConfig;
