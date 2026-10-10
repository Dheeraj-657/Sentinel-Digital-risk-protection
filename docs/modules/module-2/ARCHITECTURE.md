# Module 2 — Architecture

## Architectural style

Layered clean architecture with dependency inversion at every external
boundary. Nothing below the API layer knows about HTTP; nothing above the ML
layer knows about a specific model library; nothing in the pipeline knows
about a specific broker or database beyond SQLAlchemy session semantics.

```
api/v1  ──▶ services  ──▶ risk / ml  ──▶ (pure functions)
   │            │
   │            ├──▶ integrations (Module 1 / Module 3 boundaries)
   │            └──▶ models (SQLAlchemy)
   └──▶ schemas (Pydantic, the only types crossing the HTTP boundary)
```

Rules held by tests and review:

- **API never calls ML directly.** Routes depend on services; ML models are
  reachable only through `ModelSet` built once in the lifespan.
- **Module 2 never imports Module 1/3 persistence** — the only path to brand
  or entity data is `BrandDNAClient` / `EntityProvider` / `EvidenceProvider`
  protocols (`app/integrations/*`).
- **Risk semantics live in one file** (`app/risk/config.py`), versioned via
  `ENGINE_VERSION`; nothing else may hard-code a weight or threshold.

## Dependency wiring (composition root)

`create_app(settings, *, engine=None)` in `app/main.py` is the single
composition root. The optional `engine` parameter is a test hook (inject an
in-memory SQLite engine with `StaticPool`). Inside `lifespan`:

| app.state entry | Source | Label |
|---|---|---|
| engine / session_factory | injected engine or `create_engine(settings.database_url)` | IMPLEMENTED |
| models | `build_model_set(settings)` (registry) | IMPLEMENTED |
| risk_service | `RiskService(DEFAULT_RISK_ENGINE_CONFIG)` | IMPLEMENTED |
| publisher | `LoggingEventPublisher()` (structured log emission) | IMPLEMENTED; broker publisher EXTERNAL_DEPENDENCY |
| brand_client | `HTTPBrandDNAClient` if `module1_base_url` else `MockBrandDNAClient` | IMPLEMENTED adapter / CONTRACT_ONLY upstream |
| entity_provider, evidence_provider | `HTTPModule3Client` if `module3_base_url` else Mocks | IMPLEMENTED adapter / CONTRACT_ONLY upstream |
| evidence_service | `EvidenceService(provider, config)` | IMPLEMENTED |
| queue | `SyncJobQueue` or `InProcessJobQueue` per `worker_mode` | IMPLEMENTED (durability EXTERNAL_DEPENDENCY) |
| loop | `asyncio.get_running_loop()` — sync routes schedule enqueue via `run_coroutine_threadsafe` | IMPLEMENTED |

Routes resolve collaborators through `request.app.state` via `app/api/deps.py`
— there is no second wiring mechanism and no global singletons for request
dependencies.

## Request/job lifecycle

1. **Correlation middleware** assigns/echoes `X-Correlation-ID`, sets a fresh
   `request_id` in a `contextvar`; the JSON formatter stamps both onto every
   log line.
2. **Metrics middleware** observes `http_request_duration_seconds` and
   `http_requests_total` with `method/path/status` labels (unmatched long
   paths collapse to `/:unmatched` to bound cardinality).
3. **Body-size middleware** rejects `Content-Length > max_request_body_bytes`
   with a 413 error envelope before routing.
4. **Route handler** (sync `def`, runs on the worker thread):
   - `get_db` yields a request-scoped session (commit on success, rollback on
     exception).
   - `get_tenant` enforces `X-Tenant-ID` (UUID) — tenancy never comes from
     the body.
5. **POST /analysis**: idempotency resolution → commit → enqueue via
   `run_coroutine_threadsafe(queue.enqueue(...), app.state.loop)` →
   response. With `worker_mode=sync` the route awaits completion and returns
   the final job state with HTTP 200; otherwise 202 (or 200 on idempotent
   replay).
6. **Worker**: `AnalysisExecutor.execute(job_id)` runs the pipeline on a
   fresh session; the queue owns the commit. Failures roll back, persist
   FAILED job state, publish `analysis.failed`, and re-raise — the queue
   survives one bad job.

## Error model

`AppError(code, message, http_status, details)` with typed subclasses in
`app/core/errors.py`. The exception handler renders:

```json
{"error_code": "...", "message": "...", "details": {...}|null, "correlation_id": "..."}
```

Internal stack traces are logged (`exc_info`) and never serialized — the
generic `Exception` handler returns `INTERNAL_ERROR` / 500 with no internals.
`RequestValidationError` is re-rendered into the same envelope with
structured `details.errors`.

## Extension points (designed, not speculative)

| Swap point | Mechanism | Trigger |
|---|---|---|
| Text model | `TRUSTGRAPH_TEXT_MODEL` registry key | `sklearn_tfidf` ships in-repo; embedding models land behind the same protocol |
| Visual model | `TRUSTGRAPH_VISUAL_MODEL` | real pHash/embedding service |
| Identity model | `TRUSTGRAPH_IDENTITY_MODEL` | richer identity resolution |
| Queue | implement `AnalysisJobQueue` protocol (4 methods) | Celery/Arq/SQS for durability |
| Publisher | implement `EventPublisher.publish` | Kafka/RabbitMQ |
| Database | `TRUSTGRAPH_DATABASE_URL` | PostgreSQL in production (SQLite default for dev/tests) |
| Auth | replace `get_tenant` dependency | real identity provider (TBD — out of scope) |

## What was deliberately NOT built

- No scraping/crawling/ingestion (Module 3's job), no brand management
  (Module 1), no investigation workflow (Module 4), no auth/identity system,
  no notification channel, no fake "production" implementations of missing
  upstreams. Absences are labeled `CONTRACT_ONLY` / `MOCK` / `TBD` /
  `EXTERNAL_DEPENDENCY` and stated in INTEGRATION_MATRIX.md.
