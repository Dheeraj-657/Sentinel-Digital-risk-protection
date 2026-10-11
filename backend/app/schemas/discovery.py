"""Discovery job API schemas."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.domain.enums import DiscoveryJobStatus


class DiscoveryCreateRequest(BaseModel):
    """Request body for POST /api/v1/discovery.

    tenant_id is bound from the authenticated tenant context, matching
    /api/v1/analysis — never trusted from the body.
    """

    brand_id: uuid.UUID = Field(description="Module 1 brand whose DNA seeds discovery")


class DiscoveryQueryItem(BaseModel):
    provider: str
    term: str
    basis: str = Field(description="Brand DNA signal the term was derived from")


class DiscoveryProviderOutcomeItem(BaseModel):
    provider: str
    status: str
    candidate_count: int = 0
    warning: str | None = None
    error: str | None = None
    latency_ms: int | None = None


class DiscoveryCandidateItem(BaseModel):
    """One normalized candidate: who observed it, on what basis, and where it
    went (Module 3 entity/evidence + chained analysis job). An observation is
    never a malice verdict."""

    providers: list[str]
    kind: str
    domain: str | None = None
    url: str | None = None
    title: str | None = None
    snippet: str | None = None
    query_basis: str
    observed_at: datetime
    discovery_fingerprint: str | None = Field(
        default=None,
        description="Stable identity of the observation; matches the same key "
        "in the Module 3 evidence metadata so candidates are traceable.",
    )
    entity_id: uuid.UUID | None = None
    evidence_id: uuid.UUID | None = None
    analysis_job_id: uuid.UUID | None = None
    analysis_status: str | None = None


class DiscoveryJobResponse(BaseModel):
    """Job payload for POST /api/v1/discovery and GET /api/v1/discovery/{job_id}."""

    model_config = ConfigDict(from_attributes=True)

    job_id: uuid.UUID = Field(
        validation_alias=AliasChoices("job_id", "id")
    )  # ORM PK column is `id`
    status: DiscoveryJobStatus
    brand_id: uuid.UUID
    queries: list[DiscoveryQueryItem] = Field(default_factory=list)
    provider_outcomes: list[DiscoveryProviderOutcomeItem] = Field(default_factory=list)
    candidates: list[DiscoveryCandidateItem] = Field(default_factory=list)
    source_ids: dict[str, str] = Field(default_factory=dict)
    duplicate_count: int = 0
    warning_message: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_code: str | None = None
    error_message: str | None = None


class DiscoveryJobListItem(BaseModel):
    """One row of GET /api/v1/discovery."""

    job_id: uuid.UUID
    status: DiscoveryJobStatus
    brand_id: uuid.UUID
    duplicate_count: int
    candidate_count: int
    created_at: datetime
    completed_at: datetime | None = None
    error_code: str | None = None


class DiscoveryJobListResponse(BaseModel):
    items: list[DiscoveryJobListItem]
    total: int
    limit: int
    offset: int
