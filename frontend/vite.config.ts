/// <reference types="vitest/config" />
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev proxy. Module 2 deliberately has no CORS middleware (frozen canonical
// risk engine), so the dev server fronts all three services instead:
//   /api/brands, /api/health, /api/scans, /api/stats → Module 1 (Sentinel DRP, :3000)
//   /api/v1/entities, /api/v1/sources  → Module 3 (Entity & Evidence, :8001)
//   /api/v1/*, /readyz                 → Module 2 (Risk Engine, :8000)
//   /healthz                           → Module 3 (Module 2 uses /readyz)
// Key order matters: /api/v1/entities must precede /api/v1.
// When a module is not running, answer with a clear JSON 502 naming it instead of
// the proxy's bare 500 — the console then says *which* service is unreachable.
type ProxyResponse = {
  headersSent?: boolean;
  writeHead?: (status: number, headers: Record<string, string>) => unknown;
  end: (body: string) => unknown;
};

function upstream(target: string, service: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on("error", (_err, _req, res) => {
        const out = res as unknown as ProxyResponse;
        if (!out || typeof out.writeHead !== "function" || out.headersSent) return;
        out.writeHead(502, { "content-type": "application/json" });
        out.end(
          JSON.stringify({
            error_code: "SERVICE_UNAVAILABLE",
            message: `${service} is not reachable at ${target}. Start it (npm run dev) and retry.`,
          }),
        );
      });
    },
  };
}

const M1 = (): ProxyOptions => upstream("http://localhost:3000", "Brand service (Module 1)");
const M2 = (): ProxyOptions => upstream("http://localhost:8000", "Risk engine (Module 2)");
const M3 = (): ProxyOptions => upstream("http://localhost:8001", "Evidence store (Module 3)");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api/brands": M1(),
      "/api/health": M1(),
      "/api/scans": M1(),
      "/api/stats": M1(),
      "/api/v1/entities": M3(),
      "/api/v1/sources": M3(),
      "/api/v1": M2(),
      "/readyz": M2(),
      "/healthz": M3(),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
