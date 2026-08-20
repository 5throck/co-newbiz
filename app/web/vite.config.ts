import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// co-newbiz web SPA — design v1.0 §4-10, docs/ui-spec.md.
// Dev server proxies /api to the Hono backend (app/server, default port
// 8787) so the SPA and API share one origin during development, matching
// production where app/server/index.ts serves app/web/dist directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.CO_NEWBIZ_PORT ?? 8787}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
