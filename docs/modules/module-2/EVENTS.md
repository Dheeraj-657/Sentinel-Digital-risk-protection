# Module 2 — Events

Versioned domain events describing facts that already happened. Emitted
through the `EventPublisher` protocol — no broker coupling in business code.

| Property | Value |
|---|---|
| Producer | `trustgraph-module-2` |
| Envelope | `{"metadata": {...}, "data": {...}}` (`event_envelope` in `app/events/schemas.py`) |
| `event_version` | `"1.0"` for all current events |
| `metadata` fields | `event_id` (UUID), `event_type`, `event_version`, `occurred_at` (UTC), `producer`, `tenant_id`, `correlation_id` |

`correlation_id` falls back to the request-scoped contextvar when not passed
explicitly, so every event in a request/job chain is traceable.

## Catalog

| event_type | Model | Emitted by | data fields |
|---|---|---|---|
| `analysis.started` | `AnalysisStartedEvent` | executor, job entering RUNNING | `job_id`, `brand_id`, `entity_id` |
| `analysis.completed` | `AnalysisCompletedEvent` | executor, after persistence | `job_id`, `threat_id`, `risk_score`, `risk_level`, `classification` |
| `analysis.failed` | `AnalysisFailedEvent` | executor failure path | `job_id`, `error_code` |
| `threat.created` | `ThreatCreatedEvent` | executor, first verdict for (tenant, brand, entity) | `threat_id`, `entity_id`, `brand_id`, `risk_score`, `risk_level`, `classification`, `factor_types` |
| `risk.recalculated` | `RiskRecalculatedEvent` | executor, re-analysis with a changed factor signature | `threat_id`, `entity_id`, `brand_id`, `previous_score`, `new_score`, `risk_level`, `classification` |
| `threat.status_changed` | `ThreatStatusChangedEvent` | PATCH /threats/{id}/status | `threat_id`, `previous_status`, `new_status` |

Notes:

- `risk.recalculated` fires only when the **factor signature** changed
  (`computed_factor_signature` in `risk_service.py`: tuple of
  `(factor_type, score, weight, contribution)`). Re-running an identical
  analysis is NOT an event — no noise, deterministic.
- `analysis.failed` carries only the `error_code` (no messages, no stack
  traces, no upstream details).
- Event payload models are frozen Pydantic models; the wire format is their
  `model_dump(mode="json")` split into envelope halves.

## Publisher boundary

```python
class EventPublisher(Protocol):
    def publish(self, event: object) -> None: ...
```

| Implementation | Status | Behavior |
|---|---|---|
| `InMemoryEventPublisher` | MOCK | Collects envelopes in a list for assertions (tests, single-node dev) |
| `LoggingEventPublisher` | IMPLEMENTED (default) | Emits the envelope as one structured log line (`domain_event`) |
| Broker publisher (Kafka/RabbitMQ/…) | EXTERNAL_DEPENDENCY | Implement `publish`; bind in the lifespan — zero business-code changes |

Publication never breaks business flow: the executor wraps `publish` in a
guard that logs `event publication failed` and continues (a metrics/at-least-once
broker binding should apply its own retry/dead-letter policy — TBD at
integration time).

## Consumed by Module 4

Module 4 consumes `threat.created`, `risk.recalculated`, and
`threat.status_changed` to maintain its investigation graph. Consumers must
key on `metadata.event_id` for dedup (at-least-once semantics) and tolerate
`event_version`-gated field additions.
