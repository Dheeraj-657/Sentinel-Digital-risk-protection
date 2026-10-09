/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev proxy. Module 2 deliberately has no CORS middleware (frozen canonical
// risk engine), so the dev server fronts all three services instead:
//   /api/brands, /api/health, /api/scans, /api/stats → Module 1 (Sentinel DRP, :3000)
//   /api/v1/entities, /api/v1/sources  → Module 3 (Entity & Evidence, :8001)
//   /api/v1/*, /readyz                 → Module 2 (Risk Engine, :8000)
//   /healthz                           → Module 3 (Module 2 uses /readyz)
// Key order matters: /api/v1/entities must precede /api/v1.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api/brands": { target: "http://localhost:3000", changeOrigin: true },
      "/api/health": { target: "http://localhost:3000", changeOrigin: true },
      "/api/scans": { target: "http://localhost:3000", changeOrigin: true },
      "/api/stats": { target: "http://localhost:3000", changeOrigin: true },
      "/api/v1/entities": { target: "http://localhost:8001", changeOrigin: true },
      "/api/v1/sources": { target: "http://localhost:8001", changeOrigin: true },
      "/api/v1": { target: "http://localhost:8000", changeOrigin: true },
      "/readyz": { target: "http://localhost:8000", changeOrigin: true },
      "/healthz": { target: "http://localhost:8001", changeOrigin: true },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
