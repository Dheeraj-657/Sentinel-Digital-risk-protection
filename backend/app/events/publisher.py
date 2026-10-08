"""Event publisher boundary — no broker coupling.

Production deployments bind a broker-backed publisher (Kafka/RabbitMQ/etc.)
without touching emitting code. The in-memory publisher is for tests and
single-node dev, and is labeled MOCK.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.core.logging import get_logger
from app.events.schemas import event_envelope

logger = get_logger("app.events")


@runtime_checkable
class EventPublisher(Protocol):
    def publish(self, event: object) -> None:
        """Deliver one domain event. Must not raise into business flow."""
        ...


class InMemoryEventPublisher:
    """MOCK — collects events in a list; useful for assertions in tests."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    def publish(self, event: object) -> None:
        envelope = event_envelope(event)  # type: ignore[arg-type]
        self.events.append(envelope)
        logger.info("event_published", extra={"context": {"event_type": envelope["metadata"]["event_type"]}})


class LoggingEventPublisher:
    """Minimal production-safe default: structured log emission. Swap for a
    real broker publisher at deployment time (EXTERNAL_DEPENDENCY)."""

    def publish(self, event: object) -> None:
        envelope = event_envelope(event)  # type: ignore[arg-type]
        logger.info("domain_event", extra={"context": envelope})
