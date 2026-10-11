"""Versioned domain events emitted by Module 2.

Events describe facts that already happened. Schemas are versioned
(event_version) so consumers can evolve independently. No broker coupling:
publishers are behind the EventPublisher interface.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain.enums import FactorType, JobStatus, RiskLevel, ThreatClassification

Producer = Literal["trustgraph-module-2"]


class EventMetadata(BaseModel):
    model_config = ConfigDict(frozen=True)

    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    event_type: str
    event_version: str = "1.0"
    occurred_at: datetime
    producer: Producer = "trustgraph-module-2"
    tenant_id: str
    correlation_id: str


class AnalysisStartedEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    metadata: EventMetadata
    job_id: str
    brand_id: str
    entity_id: str


class AnalysisCompletedEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    metadata: EventMetadata
    job_id: str
    threat_id: str | None
    risk_score: int
    risk_level: RiskLevel
    classification: ThreatClassification


class AnalysisFailedEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    metadata: EventMetadata
    job_id: str
    error_code: str


class ThreatCreatedEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    metadata: EventMetadata
    threat_id: str
    entity_id: str
    brand_id: str
    risk_score: int
    risk_level: RiskLevel
    classification: ThreatClassification
    factor_types: list[FactorType]


class RiskRecalculatedEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    metadata: EventMetadata
    threat_id: str
    entity_id: str
    brand_id: str
    previous_score: int
    new_score: int
    risk_level: RiskLevel
    classification: ThreatClassification


class ThreatStatusChangedEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    metadata: EventMetadata
    threat_id: str
    previous_status: str
    new_status: str


EVENT_TYPE_TO_MODEL: dict[str, type[BaseModel]] = {
    "analysis.started": AnalysisStartedEvent,
    "analysis.completed": AnalysisCompletedEvent,
    "analysis.failed": AnalysisFailedEvent,
    "threat.created": ThreatCreatedEvent,
    "risk.recalculated": RiskRecalculatedEvent,
    "threat.status_changed": ThreatStatusChangedEvent,
}


def build_metadata(event_type: str, tenant_id: str, correlation_id: str) -> EventMetadata:
    from app.core.logging import get_correlation_id
    from app.models.base import utcnow

    return EventMetadata(
        event_type=event_type,
        occurred_at=utcnow(),
        tenant_id=tenant_id,
        correlation_id=correlation_id or get_correlation_id(),
    )


def event_envelope(event: BaseModel) -> dict[str, Any]:
    """Wire format: {metadata: {...}, data: {...}} — stable outer shape."""
    return {
        "metadata": event.metadata.model_dump(mode="json"),
        "data": event.model_dump(mode="json", exclude={"metadata"}),
    }
