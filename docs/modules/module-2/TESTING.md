# Module 2 — Testing

Suite location: `backend/tests/`. Run:

```bash
cd backend
python -m pytest tests/
```

Last verified result (2026-10-08): **93 passed in 2.73s** (Python 3.14,
Windows, default SQLite engine). `pyproject.toml` sets `testpaths`,
`pythonpath = ["."]`, `-q`, and filters DeprecationWarnings.

## Test data policy

Every fixture entity, brand, and evidence item in this suite is synthetic and
labeled `SYNTHETIC TEST_ONLY` (see `tests/conftest.py`). No external service
is called by the unit/contract tests: Module 1/3 interactions are either
in-memory mocks or `httpx` transports faked in-process. Nothing in the suite
fabricates "production" upstream behavior.

## Files

| File | Focus | Count-ish coverage |
|---|---|---|
| `conftest.py` | Fixtures: in-memory SQLite engine (StaticPool) + `create_all`, Settings, ModelSet, per-test UUIDs for tenant/brand/entity/source, synthetic BrandDNA/Entity/evidence items, mock collaborators, RiskService, EvidenceService, publisher | shared |
| `test_risk_engine.py` | Pure engine math: contribution = score×weight, omission without evidence, clamping [0,100], level boundaries (25/26, 50/51, 75/76), half-up rounding (50.5→51), confidence weighting, [0,1] interval, engine_version passthrough, determinism, config validation errors, classifier ladder incl. PHISHING priority and two-of-three impersonation → UNKNOWN | engine |
| `test_ml_models.py` | Each baseline model: identical→1.0, near→>0.95, opposite→0.0, empty→0.0, case/whitespace insensitivity, invalid hex non-fatal, range clamps; registry protocol conformance, exact version string, unknown model → `ModelUnavailableError` with `details.model_name`, ModelSet frozen | ML |
| `test_contracts.py` | Integration adapters against faked `httpx.get` (monkeypatch): success validation, 404 → MissingBrandDNAError, 500 → IntegrationUnavailableError("http_500") with NO upstream body leak, invalid JSON, contract mismatch, network error; X-Tenant-ID forwarded downstream; 403/404 indistinguishability; schema round-trips; EvidenceService gating + citation mapping | boundaries |
| `test_jobs_idempotency.py` | Job creation/fetch; fingerprint canonicalization (key order irrelevant); same key+same body → same job (no new job); same key+different body → DuplicateJobError; no key → new job; expired record replacement | idempotency |
| `test_pipeline.py` | AnalysisExecutor end-to-end on the synthetic fixtures: verdict persisted, threat upsert vs create, factor replacement, AnalysisResult snapshot fields, evidence references, emitted event types + envelope shape (`e["data"][...]`, `e["metadata"]["event_type"]`), failure path → FAILED job + `analysis.failed` | pipeline |
| `test_api.py` | Full HTTP surface via TestClient: sync completion (200 COMPLETED with result), idempotent replay (echoed key), 409 conflict, tenant header enforcement (400s), job get / 404 envelope, 422 envelope details.errors, 413 oversized body, threat list/detail explainability fields, status transitions with the 3 status_changed events verified in order, tenant isolation (empty list + 404 detail), /healthz /readyz /metrics, X-Correlation-ID echo | API |

## Patterns worth knowing

- **App factory with engine injection**: `create_app(settings, engine=...)`
  receives the in-memory SQLite engine — no disk, no network.
- **Post-startup collaborator rebind**: after `with TestClient(app) as
  client:` starts the lifespan, tests REBIND
  `app.state.brand_client/entity_provider/evidence_provider/evidence_service/publisher`
  AND rebuild `app.state.queue = SyncJobQueue(executor_factory(...),
  session_factory)` — the queue's factory closes over the lifespan's
  collaborators, so both must be refreshed.
- **Sync worker mode** (`Settings(worker_mode=...)`) makes POST /analysis
  return the completed job deterministically — no sleeps, no polling.
- **HTTP contract fakes**: `monkeypatch.setattr(httpx, "get", fake_get)` with
  a `FakeResponse` capturing `httpx.Request` — asserts URL, headers, and
  error mapping without sockets.
- **Event assertions** use the envelope shape:
  `e["data"]["previous_status"]`, `e["metadata"]["event_type"]`.

## What is NOT covered (honest gaps)

- InProcessJobQueue concurrency under load (only construction + enqueue
  counter are exercised; the pipeline tests use sync mode).
- Alembic migration against a live PostgreSQL server (migrations run on
  SQLite in dev; PostgreSQL is an EXTERNAL_DEPENDENCY not present here).
- Real Module 1/3 HTTP integration (modules do not exist — contract tests
  fake the transport).
- Performance/load testing — not in scope for this phase.
