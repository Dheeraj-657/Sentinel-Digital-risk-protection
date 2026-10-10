# Module 2 — Deployment

## Requirements

- Python ≥ 3.11 (verified on 3.14)
- PostgreSQL in production (SQLAlchemy 2.x + Alembic); SQLite default is for
  dev/tests only
- Network access to Module 1 and Module 3 services when running with real
  integrations

## Configuration

All settings are environment variables with the `TRUSTGRAPH_` prefix
(pydantic-settings; a `.env` file in the working directory is also read).
No secrets in source code, ever.

| Variable | Default | Meaning |
|---|---|---|
| `TRUSTGRAPH_ENVIRONMENT` | `development` | free-form environment name |
| `TRUSTGRAPH_LOG_LEVEL` | `INFO` | root log level |
| `TRUSTGRAPH_API_V1_PREFIX` | `/api/v1` | API prefix |
| `TRUSTGRAPH_DATABASE_URL` | `sqlite:///./trustgraph_module2.db` | SQLAlchemy URL; use `postgresql+psycopg://…` in production (driver install is the deployer's step) |
| `TRUSTGRAPH_MODULE1_BASE_URL` | unset → **MockBrandDNAClient** | Module 1 service root |
| `TRUSTGRAPH_MODULE3_BASE_URL` | unset → **MockEntityProvider/EvidenceProvider** | Module 3 service root |
| `TRUSTGRAPH_INTEGRATION_HTTP_TIMEOUT_SECONDS` | `10.0` | timeout for Module 1/3 calls |
| `TRUSTGRAPH_WORKER_MODE` | `in_process` | `in_process` (asyncio workers) or `sync` (inline in request) |
| `TRUSTGRAPH_WORKER_CONCURRENCY` | `2` | in-process worker count |
| `TRUSTGRAPH_IDEMPOTENCY_RETENTION_HOURS` | `24` | Idempotency-Key record TTL |
| `TRUSTGRAPH_TEXT_MODEL` | `char_ngram_tfidf` | registry key (alt: `sklearn_tfidf`) |
| `TRUSTGRAPH_VISUAL_MODEL` | `phash_hamming` | registry key |
| `TRUSTGRAPH_IDENTITY_MODEL` | `token_similarity` | registry key |
| `TRUSTGRAPH_MAX_REQUEST_BODY_BYTES` | `65536` | 413 threshold |

**MOCK-mode rule**: if either base URL is unset, the app binds mock adapters
and logs `mock_integrations: true` at startup. That deployment is a
contract/dev environment; it must not be presented as producing real threat
intelligence. `Settings.using_mock_integrations` is the flag.

## Install & migrate

```bash
pip install -e ".[dev]"           # core; add [ml] for the sklearn adapter
alembic upgrade head              # apply backend/alembic/versions/f15fb873cb2f_*.py
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`app.main:app` is a pre-built module-level app (`create_app()`); import the
factory directly for custom wiring (`create_app(settings, engine=...)`).

## Worker modes

| Mode | Behavior | Choose when |
|---|---|---|
| `in_process` (default) | POST returns 202 immediately; asyncio workers (concurrency N) drain an in-memory queue; per-job fresh session; queue survives individual job failures | single-node deployments; simplest ops |
| `sync` | pipeline executes within the request; POST returns the final COMPLETED/FAILED job with 200 | determinism-first deployments, smoke tests |

Durability truth: the in-process queue keeps jobs in memory — a crash can
lose QUEUED work (job rows persist; re-submission is idempotent-safe).
Durable execution requires a broker-backed `AnalysisJobQueue`
implementation — the protocol has exactly four methods
(`enqueue/start/stop/join`), making the swap mechanical
(EXTERNAL_DEPENDENCY).

## Events in production

Default publisher writes each envelope as one structured log line. For
Kafka/RabbitMQ: implement `EventPublisher.publish`, bind it in the lifespan
where `LoggingEventPublisher()` is constructed today. Keep "publish must not
raise into business flow" semantics (the executor already guards).

## Probes, metrics, scaling

- Liveness `/healthz`, readiness `/readyz` (DB ping).
- Scrape `/metrics` per replica (counters/histograms are process-local).
- The app is stateless apart from the database → scale horizontally behind a
  load balancer. Idempotency and threat upserts rely on DB uniqueness
  constraints, safe under concurrent replicas **on PostgreSQL** (SQLite file
  backend does not support concurrent writers — dev only).
- TLS termination at the proxy; do not expose the API to untrusted networks
  until real auth replaces the `X-Tenant-ID` trust assumption (SECURITY.md).

## Deployment checklist

- [ ] `TRUSTGRAPH_DATABASE_URL` points at PostgreSQL; `alembic upgrade head` applied
- [ ] `TRUSTGRAPH_MODULE1_BASE_URL` and `TRUSTGRAPH_MODULE3_BASE_URL` set (else: mock mode acknowledged)
- [ ] `TRUSTGRAPH_ENVIRONMENT` set; log level + aggregation wired
- [ ] `/metrics` scraped; alerts on `analysis_total{outcome="failed"}` and 5xx rates
- [ ] Readiness probe wired to `/readyz`
- [ ] Model selection reviewed (`*_MODEL` vars) and `model_version` changes noted for consumers
- [ ] Event consumer (Module 4) deployed with `event_id` dedup
