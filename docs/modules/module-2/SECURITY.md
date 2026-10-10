# Module 2 — Security

## Tenant isolation (IMPLEMENTED)

- Tenancy arrives ONLY via `X-Tenant-ID` (UUID) — `get_tenant` dependency in
  `app/api/deps.py`. Missing → `400 TENANT_REQUIRED`; malformed → `400
  VALIDATION_ERROR`. The request body deliberately cannot carry `tenant_id`
  (anti-spoofing).
- Every query filters by `tenant_id`: jobs (`JobService.get`), threats
  (`ThreatService.get_for_tenant`, list conditions). A cross-tenant id is
  indistinguishable from an unknown id (`404 NOT_FOUND`) — verified by test.
- Module 2 forwards `X-Tenant-ID` to Module 3 on every call, so isolation is
  enforced at the data owner's boundary too.
- Downstream 403 and 404 both map to `InvalidEntityError`, so callers cannot
  distinguish "entity exists elsewhere" from "entity does not exist".
- Threat uniqueness is `(tenant_id, brand_id, entity_id)` — different tenants
  analyzing the same entity get separate verdicts.
- **No second auth system**: Module 2 does not manage users, roles, or
  passwords. Until the platform provides real auth, `X-Tenant-ID` is the
  tenant context; swapping in real auth means replacing the `get_tenant`
  dependency only. (Real identity provider integration: TBD.)

## Error hygiene (IMPLEMENTED)

- Internal stack traces are logged (`exc_info` / `logger.exception`) and
  NEVER serialized; the generic handler returns
  `{"error_code":"INTERNAL_ERROR","message":"Internal server error.",...}`.
- Integration adapters never echo upstream response bodies: unexpected
  statuses map to `IntegrationUnavailableError(module, "http_NNN")`, bad JSON
  to `"invalid_json"`, schema drift to `"contract_mismatch"` — details are
  non-sensitive enums/ids. Verified by a contract test asserting the upstream
  body string does not appear in the raised error.
- `analysis.failed` events carry only `error_code`.
- Job `error_message` persisted in DB is truncated to 512 chars.

## Data minimization & PII (IMPLEMENTED by design)

- Module 2 persists scores, weights, ids, and factor metadata. Evidence
  **content** (text, image hashes' source images) stays in Module 3 — Module 2
  holds transient references only.
- No scraping, crawling, or ingestion anywhere in the codebase; nothing
  stores raw entity PII.
- Idempotency records store a sha256 fingerprint — not the request payload.

## Input handling (IMPLEMENTED)

- `Content-Length > TRUSTGRAPH_MAX_REQUEST_BODY_BYTES` (default 65,536) →
  `413 VALIDATION_ERROR` envelope before routing.
- Pydantic validates every body/param; failures render as the structured
  `VALIDATION_ERROR` envelope with field locations (never raw internals).
- UUID types enforce id format at the boundary.
- SQLAlchemy parameter binding throughout; no string-composed SQL.

## Secrets & configuration (IMPLEMENTED convention)

- No secrets in source code: configuration is env-driven with the
  `TRUSTGRAPH_` prefix via pydantic-settings (`Settings`), `.env` supported
  for local dev. The repository contains no credentials; the default
  `database_url` is a local SQLite file.
- Module 1/3 base URLs are plain config (not secrets); when real credentials
  are required (API keys, mTLS), they must be injected as env/secret-manager
  values and consumed by the HTTP adapters' client construction — the
  adapters currently accept `base_url` + `timeout_seconds` only, and adding
  an auth hook there is the designated extension point (TBD with Module 1/3
  integration).

## Transport & deployment notes

- TLS termination is the deployment's responsibility (uvicorn behind a
  proxy/load balancer); Module 2 itself is transport-agnostic.
- `/metrics` exposes route labels and status codes only — no tenant ids, no
  payloads.
- Logs contain ids (tenant, job, threat, correlation), factor metadata, and
  error classes — never evidence text or brand assets.

## Threat-model notes (explicit non-goals)

- Module 2 assumes the platform edge authenticates the caller; it enforces
  tenant *authorization* on its own data. Until real auth exists, deployments
  must not expose the API untrusted networks (documented in DEPLOYMENT.md).
- Rate limiting / quotas are owned by the edge gateway (out of scope).
