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
