# Module 2 — API Contract

Base path: `/api/v1` (`TRUSTGRAPH_API_V1_PREFIX`). Interactive docs at
`/docs` when served by uvicorn. All JSON. Status labels: everything below is
IMPLEMENTED and covered by `backend/tests/test_api.py` unless noted.

## Common headers

| Header | Direction | Meaning |
|---|---|---|
| `X-Tenant-ID` | request, REQUIRED | Tenant UUID. Missing → `400 TENANT_REQUIRED`; non-UUID → `400 VALIDATION_ERROR`. Never accepted from the body. |
| `Idempotency-Key` | request, optional (POST /analysis) | Enables idempotent submission, scoped per tenant. |
| `Idempotency-Key` | response (POST) | Echoed when provided. |
| `X-Correlation-ID` | request optional / response always | Propagated or generated per request; stamped on all logs. |

## Error envelope (all non-2xx)

```json
{
  "error_code": "DUPLICATE_JOB",
  "message": "Idempotency-Key '...' was already used with a different request payload.",
  "details": {"idempotency_key": "..."},
  "correlation_id": "3f2c..."
}
```

| Code | HTTP | Raised when |
|---|---|---|
| `TENANT_REQUIRED` | 400 | `X-Tenant-ID` missing |
| `VALIDATION_ERROR` | 400 / 422 | malformed tenant header; body validation failure (`details.errors[]`); oversized body (413) |
| `NOT_FOUND` | 404 | unknown job/threat id for this tenant |
| `INVALID_ENTITY` | 404 | Module 3 reports entity missing **or** cross-tenant (indistinguishable by design) |
| `DUPLICATE_JOB` | 409 | same Idempotency-Key, different fingerprint |
| `INVALID_STATUS_TRANSITION` | 409 | CONFIRMED↔DISMISSED direct jump |
| `INSUFFICIENT_EVIDENCE` | 422 | fewer evidence items than `minimum_total_evidence` |
| `MISSING_BRAND_DNA` | 424 | Module 1 has no DNA for the brand (HTTP 404 downstream) |
| `INTEGRATION_UNAVAILABLE` | 503 | Module 1/3 unreachable, bad JSON, contract mismatch, unexpected status |
| `MODEL_UNAVAILABLE` | 503 | configured ML model name unknown or backend missing |
| `ANALYSIS_TIMEOUT` | 504 | execution budget exceeded |
| `INTERNAL_ERROR` | 500 | unhandled exception (stack trace logged, never returned) |

## Ops endpoints

| Method | Path | Response |
|---|---|---|
| GET | `/healthz` | `200 {"status": "ok", "service": "trustgraph-module-2", "version": "1.0.0"}` |
| GET | `/readyz` | `200 {"status": "ready", "checks": {"database": "ok"}}` or `503 {"status": "unready", "checks": {"database": "unavailable"}}` |
| GET | `/metrics` | Prometheus text format (counters + histograms) |

## POST /api/v1/analysis

Submit an entity for risk analysis against Brand DNA.

Request body:

```json
{"brand_id": "uuid", "entity_id": "uuid"}
```

(`tenant_id` is bound from the header, deliberately not the body.)

Responses:

| Case | HTTP | Body |
|---|---|---|
| Accepted, async worker will process | **202** | `AnalysisJobResponse` (status `QUEUED`) |
| Sync mode: completed inline | **200** | `AnalysisJobResponse` (status `COMPLETED`, `result` populated) |
| Idempotent replay (same key + same body) | **200** | original job, **no new job created** |
| Same key + different body | **409** | `DUPLICATE_JOB` |
| Missing/invalid tenant header | **400** | `TENANT_REQUIRED` / `VALIDATION_ERROR` |
| Body validation failure | **422** | `VALIDATION_ERROR` |
| Evidence below minimum / missing DNA / downstream down | **422 / 424 / 503** (job becomes `FAILED`) | typed error |

`AnalysisJobResponse`:

```json
{
  "job_id": "uuid",
  "status": "COMPLETED",
  "brand_id": "uuid",
  "entity_id": "uuid",
  "created_at": "...",
  "started_at": "...", "completed_at": "...",
  "error_code": null, "error_message": null,
  "result": {
    "result_id": "uuid",
    "threat_id": "uuid",
    "risk_score": 78,
    "risk_level": "HIGH",
    "classification": "PHISHING",
    "confidence": 0.71,
    "evidence_count": 4,
    "analysis_timestamp": "..."
  }
}
```

`risk_score` is an INTEGER 0–100; `risk_level` ∈ LOW/MEDIUM/HIGH/CRITICAL;
`classification` ∈ BRAND_IMPERSONATION/PHISHING/SUSPICIOUS_DOMAIN/UNKNOWN;
`confidence` ∈ [0,1].

## GET /api/v1/analysis/{job_id}

`200 AnalysisJobResponse` for a job owned by the tenant, else `404
NOT_FOUND` (cross-tenant ids are indistinguishable from unknown ids).

## GET /api/v1/threats

List the tenant's threats ordered by `risk_score desc, analysis_timestamp
desc`. Query params: `status` (OPEN/CONFIRMED/DISMISSED), `risk_level`
(LOW/MEDIUM/HIGH/CRITICAL), `limit` (1–200, default 50), `offset` (≥0).

```json
{
  "items": [
    {"threat_id": "uuid", "entity_id": "uuid", "brand_id": "uuid",
     "risk_score": 78, "risk_level": "HIGH", "classification": "PHISHING",
     "status": "OPEN", "analysis_timestamp": "..."}
  ],
  "total": 1, "limit": 50, "offset": 0
}
```

## GET /api/v1/threats/{threat_id}

Full explainability payload — the stable Module 4 contract. `404` if unknown
or not owned by the tenant.

```json
{
  "threat_id": "uuid",
  "tenant_id": "uuid",
  "brand_id": "uuid",
  "entity_id": "uuid",
  "risk_score": 78,
  "risk_level": "HIGH",
  "classification": "PHISHING",
  "confidence": 0.71,
  "status": "OPEN",
  "model_version": "char_ngram_tfidf@1.0+phash_hamming@1.0+token_similarity@1.0",
  "risk_engine_version": "1.0.0",
  "analysis_timestamp": "...",
  "created_at": "...",
  "updated_at": "...",
  "risk_factors": [
    {
      "factor_id": "uuid",
      "factor_type": "DOMAIN_SIGNALS",
      "score": 72,
      "weight": 0.15,
      "contribution": 10.8,
      "confidence": 0.7,
      "basis": "INFERRED",
      "evidence_ids": ["uuid"]
    }
  ],
  "evidence_references": [
    {"evidence_id": "uuid", "source_id": "uuid", "factor_types": ["DOMAIN_SIGNALS"]}
  ]
}
```

Explainability guarantees: every factor carries
`factor_id, factor_type, score, weight, contribution, confidence, basis,
evidence_ids`; `contribution = score × weight`; Σ(contributions) = risk_score
(exact for the default integer weights, ±1 from half-up rounding otherwise);
`basis` ∈ OBSERVED/DERIVED/INFERRED/PREDICTED so predictions are never
presented as facts; `evidence_references` resolves from the latest
AnalysisResult snapshot.

## PATCH /api/v1/threats/{threat_id}/status

Module 4 analyst lifecycle. Body: `{"status": "CONFIRMED" | "DISMISSED" | "OPEN"}`.

Allowed transitions: `OPEN→CONFIRMED`, `OPEN→DISMISSED`,
`CONFIRMED→OPEN`, `DISMISSED→OPEN`. Everything else → `409
INVALID_STATUS_TRANSITION` (a CONFIRMED↔DISMISSED jump must pass through
OPEN — re-review is mandatory). Success publishes `threat.status_changed`
and returns the updated `ThreatResponse`.

## Versioning

The API prefix is configuration (`TRUSTGRAPH_API_V1_PREFIX`); event and
engine semantics are versioned independently (`event_version` "1.0",
`risk_engine_version` "1.0.0"). Breaking changes to the payloads above
require a new major prefix or a new minor additive field — removals and
renames are breaking.
