"""Analysis job API schemas."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.domain.enums import JobStatus, RiskLevel, ThreatClassification


class AnalysisCreateRequest(BaseModel):
    """Request body for POST /api/v1/analysis.

    tenant_id is bound from the authenticated tenant context (X-Tenant-ID header
    until real auth exists — see SECURITY docs); it is deliberately NOT part of
    the body so callers cannot spoof tenancy.
    """

    brand_id: uuid.UUID = Field(description="Module 1 brand whose DNA anchors the comparison")
    entity_id: uuid.UUID = Field(description="Module 3 entity to analyze")


class AnalysisResultSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    result_id: uuid.UUID = Field(
        validation_alias=AliasChoices("result_id", "id")
    )  # ORM PK column is `id`
    threat_id: uuid.UUID
    risk_score: int = Field(ge=0, le=100)
    risk_level: RiskLevel
    classification: ThreatClassification
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_count: int
    analysis_timestamp: datetime


class AnalysisJobResponse(BaseModel):
    """Job status payload for POST /api/v1/analysis and GET /api/v1/analysis/{job_id}."""

    model_config = ConfigDict(from_attributes=True)

    job_id: uuid.UUID = Field(
        validation_alias=AliasChoices("job_id", "id")
    )  # ORM PK column is `id`
    status: JobStatus
    brand_id: uuid.UUID
    entity_id: uuid.UUID
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_code: str | None = None
    error_message: str | None = None
    result: AnalysisResultSummary | None = None


class AnalysisJobListItem(BaseModel):
    """One row of the job-history list (GET /api/v1/analysis).

    The ORM job has no updated_at column and the schema layer is frozen, so
    started_at/completed_at stand in for recency and threat_id is joined from
    AnalysisResult — present for completed jobs only.
    """

    job_id: uuid.UUID
    status: JobStatus
    brand_id: uuid.UUID
    entity_id: uuid.UUID
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_code: str | None = None
    threat_id: uuid.UUID | None = None


class AnalysisJobListResponse(BaseModel):
    items: list[AnalysisJobListItem]
    total: int
    limit: int
    offset: int
