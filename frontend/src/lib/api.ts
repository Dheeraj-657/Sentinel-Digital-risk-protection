import type {
  AnalysisJob,
  M1Brand,
  M1BrandInput,
  M1Health,
  M1RiskLevel,
  M1ScanCreated,
  M1ScanDetail,
  M1ScanListResponse,
  M1ScanRequest,
  M1EntityType,
  M1Stats,
  M2JobListResponse,
  M3Entity,
  M3EntityListResponse,
  M3EntityListItem,
  M3EntityType,
  M3Evidence,
  M3EvidenceType,
  M3Source,
  M3SourceListResponse,
  JobStatus,
  RiskLevel,
  ThreatDetail,
  ThreatListResponse,
  ThreatStatus,
} from "./types";

export class ApiError extends Error {
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
}

export interface FetchOptions {
  method?: string;
  body?: unknown;
  /** X-Tenant-ID — required by Module 2 and Module 3, unused by Module 1. */
  tenant?: string | null;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

function parseErrorBody(body: unknown): { code: string; message: string; details?: unknown } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  // Module 2/3 envelope: {error_code, message, details}
  if (typeof record.error_code === "string") {
    return {
      code: record.error_code,
      message: typeof record.message === "string" ? record.message : "Request failed.",
      details: record.details,
    };
  }
  // Module 1 envelope: {error: {code, message}}
  const inner = record.error;
  if (inner && typeof inner === "object") {
    const error = inner as Record<string, unknown>;
    if (typeof error.code === "string") {
      return {
        code: error.code,
        message: typeof error.message === "string" ? error.message : "Request failed.",
      };
    }
  }
  return null;
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.tenant) headers["X-Tenant-ID"] = options.tenant;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the service — is it running?");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }

  if (!response.ok) {
    const parsed = parseErrorBody(body);
    throw new ApiError(
      response.status,
      parsed?.code ?? `HTTP_${response.status}`,
      parsed?.message ?? `Request failed with status ${response.status}.`,
      parsed?.details,
    );
  }
  return body as T;
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

// ---------- Module 2 (Risk Engine, :8000 via proxy) ----------

export type ThreatQueryParams = {
  status?: ThreatStatus;
  risk_level?: RiskLevel;
  limit?: number;
  offset?: number;
};

export type JobQueryParams = {
  status?: JobStatus;
  limit?: number;
  offset?: number;
};

export const m2 = {
  ready: (signal?: AbortSignal) =>
    apiFetch<{ status: string; database: string }>("/readyz", { signal }),

  createAnalysis: (
    brandId: string,
    entityId: string,
    tenant: string,
    signal?: AbortSignal,
  ) =>
    apiFetch<AnalysisJob>("/api/v1/analysis", {
      method: "POST",
      body: { brand_id: brandId, entity_id: entityId },
      tenant,
      idempotencyKey: crypto.randomUUID(),
      signal,
    }),

  getAnalysis: (jobId: string, tenant: string, signal?: AbortSignal) =>
    apiFetch<AnalysisJob>(`/api/v1/analysis/${jobId}`, { tenant, signal }),

  listJobs: (params: JobQueryParams, tenant: string, signal?: AbortSignal) =>
    apiFetch<M2JobListResponse>(`/api/v1/analysis${queryString(params)}`, { tenant, signal }),

  listThreats: (params: ThreatQueryParams, tenant: string, signal?: AbortSignal) =>
    apiFetch<ThreatListResponse>(`/api/v1/threats${queryString(params)}`, { tenant, signal }),

  getThreat: (threatId: string, tenant: string, signal?: AbortSignal) =>
    apiFetch<ThreatDetail>(`/api/v1/threats/${threatId}`, { tenant, signal }),

  updateThreatStatus: (
    threatId: string,
    status: ThreatStatus,
    tenant: string,
    signal?: AbortSignal,
  ) =>
    apiFetch<ThreatDetail>(`/api/v1/threats/${threatId}/status`, {
      method: "PATCH",
      body: { status },
      tenant,
      signal,
    }),
};

// ---------- Module 3 (Entity & Evidence, :8001 via proxy) ----------

export type EntityQueryParams = {
  entity_type?: M3EntityType;
  q?: string;
  limit?: number;
  offset?: number;
};

export const m3 = {
  health: (signal?: AbortSignal) =>
    apiFetch<{ status: string; service: string; version: string }>("/healthz", { signal }),

  listEntities: (params: EntityQueryParams, tenant: string, signal?: AbortSignal) =>
    apiFetch<M3EntityListResponse>(`/api/v1/entities${queryString(params)}`, { tenant, signal }),

  getEntity: (entityId: string, tenant: string, signal?: AbortSignal) =>
    apiFetch<M3Entity>(`/api/v1/entities/${entityId}`, { tenant, signal }),

  createEntity: (
    payload: {
      entity_type: M3EntityType;
      display_name?: string;
      identifiers: Record<string, string>;
      attributes?: Record<string, unknown>;
    },
    tenant: string,
    signal?: AbortSignal,
  ) =>
    apiFetch<M3Entity>("/api/v1/entities", { method: "POST", body: payload, tenant, signal }),

  updateEntity: (
    entityId: string,
    payload: {
      display_name?: string;
      identifiers?: Record<string, string>;
      attributes?: Record<string, unknown>;
    },
    tenant: string,
    signal?: AbortSignal,
  ) =>
    apiFetch<M3EntityListItem>(`/api/v1/entities/${entityId}`, {
      method: "PATCH",
      body: payload,
      tenant,
      signal,
    }),

  listEvidence: (entityId: string, tenant: string, signal?: AbortSignal) =>
    apiFetch<M3Evidence[]>(`/api/v1/entities/${entityId}/evidence`, { tenant, signal }),

  createEvidence: (
    entityId: string,
    payload: {
      source_id: string;
      evidence_type: M3EvidenceType;
      text?: string | null;
      url?: string | null;
      image_hash?: string | null;
      metadata?: Record<string, unknown>;
    },
    tenant: string,
    signal?: AbortSignal,
  ) =>
    apiFetch<M3Evidence>(`/api/v1/entities/${entityId}/evidence`, {
      method: "POST",
      body: payload,
      tenant,
      signal,
    }),

  listSources: (params: EntityQueryParams, tenant: string, signal?: AbortSignal) =>
    apiFetch<M3SourceListResponse>(`/api/v1/sources${queryString(params)}`, { tenant, signal }),

  createSource: (
    payload: { name: string; kind: string },
    tenant: string,
    signal?: AbortSignal,
  ) =>
    apiFetch<M3Source>("/api/v1/sources", { method: "POST", body: payload, tenant, signal }),
};

// ---------- Module 1 (Sentinel DRP, :3000 via proxy) ----------

export type ScanQueryParams = {
  type?: M1EntityType;
  level?: M1RiskLevel;
  q?: string;
  target?: string;
  brand?: string;
  limit?: number;
  cursor?: string;
};

export const m1 = {
  listBrands: (signal?: AbortSignal) =>
    apiFetch<{ items: M1Brand[] }>("/api/brands", { signal }),

  health: (signal?: AbortSignal) => apiFetch<M1Health>("/api/health", { signal }),

  getBrand: (id: string, signal?: AbortSignal) =>
    apiFetch<M1Brand>(`/api/brands/${id}`, { signal }),

  createBrand: (payload: M1BrandInput, signal?: AbortSignal) =>
    apiFetch<{ id: string }>("/api/brands", { method: "POST", body: payload, signal }),

  updateBrand: (id: string, payload: M1BrandInput, signal?: AbortSignal) =>
    apiFetch<M1Brand>(`/api/brands/${id}`, { method: "PATCH", body: payload, signal }),

  deleteBrand: (id: string, signal?: AbortSignal) =>
    apiFetch<void>(`/api/brands/${id}`, { method: "DELETE", signal }),

  listScans: (params: ScanQueryParams, signal?: AbortSignal) =>
    apiFetch<M1ScanListResponse>(`/api/scans${queryString(params)}`, { signal }),

  getScan: (id: string, signal?: AbortSignal) =>
    apiFetch<M1ScanDetail>(`/api/scans/${id}`, { signal }),

  createScan: (payload: M1ScanRequest, signal?: AbortSignal) =>
    apiFetch<M1ScanCreated>("/api/scans", { method: "POST", body: payload, signal }),

  deleteScan: (id: string, signal?: AbortSignal) =>
    apiFetch<void>(`/api/scans/${id}`, { method: "DELETE", signal }),

  getStats: (signal?: AbortSignal) => apiFetch<M1Stats>("/api/stats", { signal }),
};
