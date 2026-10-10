import { vi } from "vitest";

/**
 * Test double for src/lib/api. Page tests mock the module with
 * `vi.mock("../lib/api", async () => (await import("../test/api-mock")).createApiMock())`
 * and then override only the functions they care about via `vi.mocked(...)`.
 *
 * Every function resolves undefined by default, matching the real module's
 * export surface. ApiError is a local stand-in class: errorMessage() won't
 * see it as an ApiError, so tests that need error rendering should reject
 * with plain Errors (whose .message is shown as-is).
 */
function asyncFn() {
  return vi.fn(async () => undefined);
}

export function createApiMock() {
  return {
    ApiError: class ApiError extends Error {
      readonly status: number;
      readonly code: string;
      readonly details?: unknown;

      constructor(status: number, code: string, message: string, details?: unknown) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
        this.details = details;
      }
    },
    apiFetch: asyncFn(),
    m1: {
      listBrands: asyncFn(),
      health: asyncFn(),
      getBrand: asyncFn(),
      createBrand: asyncFn(),
      updateBrand: asyncFn(),
      deleteBrand: asyncFn(),
      listScans: asyncFn(),
      getScan: asyncFn(),
      createScan: asyncFn(),
      deleteScan: asyncFn(),
      getStats: asyncFn(),
    },
    m2: {
      ready: asyncFn(),
      createAnalysis: asyncFn(),
      getAnalysis: asyncFn(),
      listJobs: asyncFn(),
      listThreats: asyncFn(),
      getThreat: asyncFn(),
      updateThreatStatus: asyncFn(),
      createDiscovery: asyncFn(),
      getDiscovery: asyncFn(),
      listDiscovery: asyncFn(),
      getRelated: asyncFn(),
    },
    m3: {
      health: asyncFn(),
      listEntities: asyncFn(),
      getEntity: asyncFn(),
      createEntity: asyncFn(),
      updateEntity: asyncFn(),
      listEvidence: asyncFn(),
      createEvidence: asyncFn(),
      listSources: asyncFn(),
      createSource: asyncFn(),
    },
    m4: {
      analystStatus: asyncFn(),
      askAnalyst: asyncFn(),
    },
  };
}

export type ApiMock = ReturnType<typeof createApiMock>;
