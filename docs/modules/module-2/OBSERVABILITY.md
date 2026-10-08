# Module 2 — Observability

Three channels, all dependency-free (swap-in points documented):

1. **Structured JSON logs** with correlation context
2. **Prometheus-format metrics** from an in-process registry
3. **Health/readiness probes**

## Logging (`app/core/logging.py`)

- `configure_logging(level)` installs a single stdout `StreamHandler` with
  `JsonFormatter`; uvicorn.access/httpx/httpcore are quieted to WARNING.
- Every line: `timestamp` (UTC ISO), `level`, `logger`, `message`, plus
  `correlation_id` / `request_id` when set (contextvars — automatically
  correct across async workers and threads).
- Structured context rides in `extra={"context": {...}}` → JSON `context`
  field. (Convention: never structlog-style kwargs on the stdlib logger.)
- Errors always carry full stack traces INTERNALLY (`exc_info` /
  `logger.exception`); API responses never do (SECURITY.md).

### Audit helper

`audit(logger, event, **context)` is a context manager emitting `<event>` at
entry, `<event> completed` with merged context on `done(...)`, and `<event>
failed` with the exception on error. Used by the executor
(`analysis.execute`) and the threat-status endpoint (`threat.status_update`).

### Canonical log events

| Event | Level | Context |
|---|---|---|
| `application_started` / `application_stopped` | INFO | worker_mode, mock_integrations, models version string |
| `analysis.execute` (+ `completed` / `failed`) | INFO/ERROR | job_id, stage, evidence_count, risk_score, duration_seconds, error_code |
| `analysis.execute failed` | ERROR | job_id, error_code, full traceback |
| `threat.status_update` (+ `completed` / `failed`) | INFO/ERROR | threat_id, new_status |
| `domain_event` | INFO | full event envelope (LoggingEventPublisher) |
| `event_published` | INFO | event_type (InMemoryEventPublisher) |
| `request_failed` | ERROR | error_code, path (AppError handler; traceback internal) |
| `request_validation_failed` | WARNING | path, errors (truncated) |
| `unhandled_exception` | ERROR | path, full traceback |
| `module1_unreachable` / `module1_unexpected_status` / `module1_contract_mismatch` | WARNING | error class / status code — no upstream bodies |
| `module3_unreachable` / `module3_unexpected_status` / `module3_contract_mismatch` | WARNING | same discipline |
| `job execution failed in worker` | ERROR | job_id, worker index (queue survives) |
| `failed to persist FAILED job state` | ERROR | job_id |
| `event publication failed` | ERROR | event_type |
| `readiness_check_failed` | WARNING | check name |

## Metrics (`app/core/observability.py`)

Thread-safe in-process registry (`metrics`) rendered in Prometheus text
format at `GET /metrics` (`text/plain; version=0.0.4`). No client library —
swap for a real client behind the same interface when a backend exists.

| Metric | Type | Labels | Source |
|---|---|---|---|
| `http_requests_total` | counter | method, path, status | middleware |
| `http_request_duration_seconds` | histogram | method, path | middleware (buckets 5ms…10s) |
| `jobs_enqueued_total` | counter | — | InProcessJobQueue.enqueue |
| `analysis_total` | counter | outcome=completed\|failed | executor |
| `analysis_duration_seconds` | histogram | outcome | executor |

Cardinality guard: unmatched routes longer than 64 chars collapse to
`/:unmatched`. Metrics are per-process (reset on restart) — scraping multiple
replicas via Prometheus handles aggregation; a shared metrics backend is an
EXTERNAL_DEPENDENCY upgrade.

## Correlation propagation

`X-Correlation-ID` (request header or newly generated UUID) is stored in a
contextvar, echoed on every response, stamped on every log line, embedded in
every event's `metadata.correlation_id`, and included in every error
envelope. One id therefore ties together: HTTP request → job → pipeline logs
→ domain events → downstream Module 1/3 log correlation (the header is not
forwarded downstream today — noted as a TBD when Module 3 defines its
tracing contract).

## Probes

| Endpoint | Checks | Use |
|---|---|---|
| `/healthz` | process alive; returns service + version | liveness |
| `/readyz` | `SELECT 1` on the database; `503 {"status":"unready"}` otherwise | readiness |

## Known observability gaps (honest list)

- No distributed tracing (OpenTelemetry) — correlation ids provide the
  substrate; exporter integration TBD.
- No persistent metric storage — `/metrics` is scrape-based, in-process.
- No log shipping/retention config — deployment concern (DEPLOYMENT.md).
- Queue depth / worker lag are not exported yet (in-process queue only;
  revisit when a broker arrives).
- Latency is measured end-to-end only (`analysis_duration_seconds`); per-stage
  durations (model inference, risk calculation, queue wait) are not separately
  instrumented — stages are visible in logs (`stage`, `duration_seconds`).
