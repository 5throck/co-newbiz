import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // db/client.ts imports "bun:sqlite" — a Bun-runtime builtin. Route
  // Handlers under app/api/** must not be bundled for the Edge runtime
  // (which has no bun:sqlite); this config keeps them on the Node/Bun
  // server runtime, matching every route in this phase.
  serverExternalPackages: ["bun:sqlite"],
  // 원격(IP) 접속 시 HMR 웹소켓 차단 방지 — allowedDevOrigins에 네트워크 IP 추가
  allowedDevOrigins: ["100.104.16.127"],
};

export default nextConfig;
