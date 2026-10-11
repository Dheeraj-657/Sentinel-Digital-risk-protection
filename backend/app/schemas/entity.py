"""Module 3 integration DTOs.

STATUS: CONTRACT_PROPOSED — Module 3 (Digital Intelligence / Entity & Evidence)
does not exist in this repository. These DTOs contain ONLY the fields Module 2
requires for feature extraction. They are retrieval views, not persistence
models — Module 2 never stores or duplicates entities/evidence.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.domain.enums import EntityType, EvidenceType


class EntityReference(BaseModel):
    """Normalized entity view Module 2 analyzes. entity_id is the join key into
    Module 3; Module 2 keeps no FK to a Module 3 table."""

    model_config = ConfigDict(frozen=True)

    entity_id: uuid.UUID
    tenant_id: uuid.UUID
    entity_type: EntityType
    display_name: str | None = None
    identifiers: dict[str, str] = Field(
        default_factory=dict,
        description="Normalized identifiers, e.g. {domain: acme-support.com, handle: @acme_help}",
    )
    attributes: dict[str, Any] = Field(default_factory=dict)


class EvidenceReference(BaseModel):
    """One piece of Module 3 evidence with the content Module 2 scores.

    evidence_id + source_id are reference keys into Module 3; every Module 2
    risk factor must cite the evidence it rests on.
    """

    model_config = ConfigDict(frozen=True)

    evidence_id: uuid.UUID
    source_id: uuid.UUID
    entity_id: uuid.UUID
    evidence_type: EvidenceType
    collected_at: datetime
    text: str | None = Field(default=None, description="Textual content, if any")
    image_hash: str | None = Field(
        default=None, description="Perceptual hash of image content, if any"
    )
    url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
