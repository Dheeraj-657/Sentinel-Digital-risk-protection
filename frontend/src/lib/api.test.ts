import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError, m1, m2, m3 } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("returns parsed JSON on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiFetch<{ ok: boolean }>("/healthz")).resolves.toEqual({ ok: true });
  });

  it("returns undefined on 204", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiFetch("/anything", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("parses the Module 2/3 error envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(404, {
        error_code: "NOT_FOUND",
        message: "Entity was not found.",
        details: { entity_id: "abc" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const err = await apiFetch("/api/v1/entities/abc").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).code).toBe("NOT_FOUND");
    expect((err as ApiError).message).toBe("Entity was not found.");
    expect((err as ApiError).details).toEqual({ entity_id: "abc" });
  });

  it("parses the Module 1 error envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, { error: { code: "VALIDATION", message: "Name is required." } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const err = await apiFetch("/api/brands").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).code).toBe("VALIDATION");
    expect((err as ApiError).message).toBe("Name is required.");
  });

  it("falls back to HTTP_status when the body is not a known envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html>gateway</html>", { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const err = await apiFetch("/x").catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("HTTP_502");
    expect((err as ApiError).status).toBe(502);
  });

  it("maps network failure to NETWORK_ERROR", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const err = await apiFetch("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).code).toBe("NETWORK_ERROR");
  });

  it("sends the tenant header when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await m2.listThreats({}, "11111111-2222-3333-4444-555555555555");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("X-Tenant-ID")).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("sends no tenant header when omitted (Module 1 calls)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await m1.listBrands();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("X-Tenant-ID")).toBeNull();
  });

  it("sends an Idempotency-Key when creating an analysis", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { job_id: "j", status: "QUEUED" }));
    vi.stubGlobal("fetch", fetchMock);
    await m2.createAnalysis("brand", "entity", "tenant");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Idempotency-Key")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("serializes query params, skipping empty values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], total: 0, limit: 50, offset: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await m2.listThreats({ status: "OPEN", risk_level: undefined, limit: 25 }, "t");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/threats?status=OPEN&limit=25");
  });

  it("omits the query string entirely when no params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], total: 0, limit: 50, offset: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await m2.listThreats({}, "t");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/threats");
  });

  it("sends JSON body with Content-Type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, { source_id: "s", name: "n", kind: "fixture", created_at: "now" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await m3.createSource({ name: "test", kind: "fixture" }, "t");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ name: "test", kind: "fixture" }));
  });
});

describe("m1 scan endpoints", () => {
  it("lists scans with filters, limit, and cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], nextCursor: null, total: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await m1.listScans({ q: "acme", type: "PROFILE", level: "HIGH", limit: 25, cursor: "abc" });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/scans?q=acme&type=PROFILE&level=HIGH&limit=25&cursor=abc");
  });

  it("omits empty scan filters from the query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], nextCursor: null, total: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await m1.listScans({});
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/scans");
  });

  it("creates a scan with the normalized request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "s1", riskScore: 10 }));
    vi.stubGlobal("fetch", fetchMock);
    await m1.createScan({ entityType: "PROFILE", input: "@acme_help", brandId: "b1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/scans");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({ entityType: "PROFILE", input: "@acme_help", brandId: "b1" }),
    );
  });

  it("fetches scan detail by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { report: {}, history: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await m1.getScan("s1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/scans/s1");
    expect(init.method).toBe("GET");
  });

  it("deletes a scan via DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(m1.deleteScan("s1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/scans/s1");
    expect(init.method).toBe("DELETE");
  });
});

describe("m1 brand endpoints", () => {
  it("fetches a single brand by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "b1", name: "Acme" }));
    vi.stubGlobal("fetch", fetchMock);
    await m1.getBrand("b1");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/brands/b1");
  });

  it("creates a brand via POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "b2" }));
    vi.stubGlobal("fetch", fetchMock);
    await m1.createBrand({ name: "Acme", officialDomains: ["acme.example"] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/brands");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({ name: "Acme", officialDomains: ["acme.example"] }),
    );
  });

  it("updates a brand via PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "b1", name: "Acme 2" }));
    vi.stubGlobal("fetch", fetchMock);
    await m1.updateBrand("b1", { name: "Acme 2" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/brands/b1");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ name: "Acme 2" }));
  });

  it("deletes a brand via DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(m1.deleteBrand("b1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/brands/b1");
    expect(init.method).toBe("DELETE");
  });

  it("fetches dashboard stats", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { total: 0, levels: {}, byType: [], avgRisk: 0, avgConfidence: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await m1.getStats();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stats");
  });
});

describe("m2 listJobs", () => {
  it("lists jobs with status, limit, and offset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], total: 0, limit: 25, offset: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await m2.listJobs({ status: "COMPLETED", limit: 25, offset: 50 }, "t");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/analysis?status=COMPLETED&limit=25&offset=50");
    expect(new Headers(init.headers).get("X-Tenant-ID")).toBe("t");
  });
});

describe("m3 updateEntity and filters", () => {
  it("updates an entity via PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { entity_id: "e1", display_name: "Renamed" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await m3.updateEntity("e1", { display_name: "Renamed" }, "t");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/entities/e1");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ display_name: "Renamed" }));
    expect(new Headers(init.headers).get("X-Tenant-ID")).toBe("t");
  });

  it("lists entities with type and search filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], total: 0, limit: 25, offset: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await m3.listEntities({ entity_type: "WEBSITE", q: "acme", limit: 25 }, "t");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/entities?entity_type=WEBSITE&q=acme&limit=25");
  });
});
