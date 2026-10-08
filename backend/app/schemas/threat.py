"""Threat API schemas — the stable Module 4 contract.

Module 4 must be able to reconstruct a full investigation from
ThreatResponse alone, without any knowledge of Module 2 internals.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.domain.enums import (
    EvidenceBasis,
    FactorType,
    RiskLevel,
    ThreatClassification,
    ThreatStatus,
)


class RiskFactorOut(BaseModel):
    """One explainability unit: WHY this entity is risky.

    contribution = score * weight (normalized during aggregation).
    basis distinguishes OBSERVED / DERIVED / INFERRED / PREDICTED so
    predictions are never presented as facts.
    """

    model_config = ConfigDict(from_attributes=True)

    factor_id: uuid.UUID = Field(
        validation_alias=AliasChoices("factor_id", "id"),
        description="Risk factor id",
    )
    factor_type: FactorType
    score: int = Field(ge=0, le=100)
    weight: float = Field(ge=0.0, le=1.0)
    contribution: float
    confidence: float = Field(ge=0.0, le=1.0)
    basis: EvidenceBasis
    evidence_ids: list[uuid.UUID]


class EvidenceReferenceOut(BaseModel):
    """Reference into Module 3 evidence — never a copy of the evidence itself."""

    model_config = ConfigDict(from_attributes=True)

    evidence_id: uuid.UUID
    source_id: uuid.UUID
    factor_types: list[FactorType]


class ThreatResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    threat_id: uuid.UUID = Field(
        validation_alias=AliasChoices("threat_id", "id"),
        description="Threat id",
    )
    tenant_id: uuid.UUID
    brand_id: uuid.UUID
    entity_id: uuid.UUID
    risk_score: int = Field(ge=0, le=100)
    risk_level: RiskLevel
    classification: ThreatClassification
    confidence: float = Field(ge=0.0, le=1.0)
    status: ThreatStatus
    model_version: str
    risk_engine_version: str
    analysis_timestamp: datetime
    created_at: datetime
    updated_at: datetime
    risk_factors: list[RiskFactorOut]
    evidence_references: list[EvidenceReferenceOut]


class ThreatSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    threat_id: uuid.UUID = Field(
        validation_alias=AliasChoices("threat_id", "id"),
    )
    entity_id: uuid.UUID
    brand_id: uuid.UUID
    risk_score: int
    risk_level: RiskLevel
    classification: ThreatClassification
    status: ThreatStatus
    analysis_timestamp: datetime


class ThreatListResponse(BaseModel):
    items: list[ThreatSummary]
    total: int
    limit: int
    offset: int


class ThreatStatusUpdateRequest(BaseModel):
    """Module 4 analyst workflow: CONFIRMED / DISMISSED lifecycle changes."""

    status: ThreatStatus = Field(description="New lifecycle status (OPEN, CONFIRMED, DISMISSED)")
