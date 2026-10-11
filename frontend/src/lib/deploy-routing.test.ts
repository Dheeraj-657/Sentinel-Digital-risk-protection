import { describe, expect, it } from "vitest";
import apiSource from "./api.ts?raw";
import viteSource from "../../vite.config.ts?raw";
import vercelSource from "../../vercel.json?raw";

/**
 * Production routing must send every API path the console calls to the same
 * module as the local Vite dev proxy does. Paths come from lib/api.ts itself, so
 * a new endpoint without a Vercel rewrite fails here instead of 404-ing in prod.
 */
const vercel = JSON.parse(vercelSource) as { rewrites: { source: string; destination: string }[] };

/** Every literal path passed to apiFetch, with template parameters replaced by a sample id. */
const clientPaths = [...new Set(
  [...apiSource.matchAll(/apiFetch<[^>]*>\(\s*([`"])(\/[^`"]*)\1/g)].map((m) =>
    m[2].replace(/\$\{queryString\([^)]*\)\}/g, "").replace(/\$\{[^}]+\}/g, "sample-id"),
  ),
)];

// Local: vite proxy keys in declaration order → M1/M2/M3 helper.
const viteRoutes = [...viteSource.matchAll(/"(\/[^"]+)":\s*(M[123])\(\)/g)].map((m) => ({ prefix: m[1], module: m[2] }));
const localModule = (path: string) => viteRoutes.find((r) => path.startsWith(r.prefix))?.module;

// Production: first matching Vercel rewrite (":path*" = the path itself or any sub-path).
const HOST_MODULE: Record<string, string> = {
  "trustgraph-module1.onrender.com": "M1",
  "trustgraph-module2.onrender.com": "M2",
  "trustgraph-module3.onrender.com": "M3",
};
function matches(source: string, path: string): boolean {
  if (source === "/(.*)") return true;
  if (source.endsWith("/:path*")) {
    const base = source.slice(0, -"/:path*".length);
    return path === base || path.startsWith(`${base}/`);
  }
  return path === source;
}
const prodModule = (path: string) => {
  const rule = vercel.rewrites.find((r) => matches(r.source, path));
  if (!rule) return undefined;
  if (!rule.destination.startsWith("https://")) return `static:${rule.destination}`;
  return HOST_MODULE[new URL(rule.destination).host] ?? rule.destination;
};

describe("production routing (frontend/vercel.json)", () => {
  it("finds the client's API paths", () => {
    expect(clientPaths.length).toBeGreaterThan(15);
    expect(viteRoutes.length).toBe(9);
  });

  it.each(clientPaths)("%s reaches the same module as in local dev", (path) => {
    const local = localModule(path);
    expect(local, `no dev proxy route for ${path}`).toBeDefined();
    expect(prodModule(path)).toBe(local);
  });

  it("routes Module 3 paths before Module 2's /api/v1 catch-all", () => {
    expect(prodModule("/api/v1/entities/x/evidence")).toBe("M3");
    expect(prodModule("/api/v1/sources")).toBe("M3");
    expect(prodModule("/api/v1/threats/x/related")).toBe("M2");
  });

  it("does not let look-alike prefixes through", () => {
    expect(prodModule("/api/brandsX")).toBe("static:/index.html");
  });

  it("serves the SPA for client-side routes (deep links and refresh)", () => {
    expect(prodModule("/investigate/abc")).toBe("static:/index.html");
    expect(vercel.rewrites.at(-1)?.source).toBe("/(.*)");
  });

  it("only proxies to https and never to a placeholder", () => {
    for (const r of vercel.rewrites.filter((x) => x.destination.includes("://"))) {
      expect(r.destination.startsWith("https://")).toBe(true);
      expect(r.destination).not.toMatch(/localhost|example|<|YOUR/i);
    }
  });
});
