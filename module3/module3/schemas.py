"""Module 3 schemas — wire mirrors of Module 2's CONTRACT_PROPOSED DTOs
(backend/app/schemas/entity.py). Module 3 owns these enums per those
docstrings; tests/test_contract_parity.py gates drift against Module 2's
actual pydantic models when both packages share a venv (test-time only,
never a runtime dependency).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EntityType(str, Enum):
    """Normalized digital entity types (owned by Module 3)."""

    SOCIAL_PROFILE = "SOCIAL_PROFILE"
    WEBSITE = "WEBSITE"
    DOMAIN = "DOMAIN"
    MOBILE_APP = "MOBILE_APP"
    MESSAGING_ACCOUNT = "MESSAGING_ACCOUNT"
    OTHER = "OTHER"


class EvidenceType(str, Enum):
    """Categories of evidence Module 2 consumes (owned by Module 3)."""

    IDENTITY_MATCH = "IDENTITY_MATCH"
    TEXT_CONTENT = "TEXT_CONTENT"
    VISUAL_ASSET = "VISUAL_ASSET"
    DOMAIN_INTEL = "DOMAIN_INTEL"
    BEHAVIORAL_EVENT = "BEHAVIORAL_EVENT"
    REPUTATION_INTEL = "REPUTATION_INTEL"
    RELATIONSHIP_LINK = "RELATIONSHIP_LINK"


class EntityReference(BaseModel):
    """Normalized entity view — exactly the shape Module 2 validates via
    EntityReference.model_validate from GET /api/v1/entities/{entity_id}."""

    model_config = ConfigDict(frozen=True)

    entity_id: uuid.UUID
    tenant_id: uuid.UUID
    entity_type: EntityType
    display_name: str | None = None
    identifiers: dict[str, str] = Field(default_factory=dict)
    attributes: dict[str, Any] = Field(default_factory=dict)


class EvidenceReference(BaseModel):
    """One evidence item with provenance — exactly the shape Module 2
    validates per element from GET /api/v1/entities/{entity_id}/evidence
    (a bare JSON list, not an {"items": [...]} wrapper)."""

    model_config = ConfigDict(frozen=True)

    evidence_id: uuid.UUID
    source_id: uuid.UUID
    entity_id: uuid.UUID
    evidence_type: EvidenceType
    collected_at: datetime
    text: str | None = None
    image_hash: str | None = None
    url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SourceReference(BaseModel):
    model_config = ConfigDict(frozen=True)

    source_id: uuid.UUID
    name: str
    kind: str
    created_at: datetime


class SourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: str = Field(min_length=1, max_length=100)


class EntityCreate(BaseModel):
    entity_id: uuid.UUID | None = None
    entity_type: EntityType
    display_name: str | None = Field(default=None, max_length=300)
    identifiers: dict[str, str] = Field(default_factory=dict)
    attributes: dict[str, Any] = Field(default_factory=dict)


class EvidenceCreate(BaseModel):
    source_id: uuid.UUID
    evidence_type: EvidenceType
    collected_at: datetime | None = None
    text: str | None = None
    image_hash: str | None = None
    url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
