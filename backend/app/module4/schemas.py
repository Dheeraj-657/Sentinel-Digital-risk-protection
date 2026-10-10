"""Module 4 analyst API contract (additive; does not touch Module 2 schemas)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class AnalystTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AnalystRequest(BaseModel):
    """One analyst question about a threat and/or entity of the caller's tenant."""

    question: str = Field(min_length=2, max_length=1000)
    threat_id: uuid.UUID | None = None
    entity_id: uuid.UUID | None = None
    compare_threat_id: uuid.UUID | None = Field(
        default=None, description="Optional second threat for comparison questions."
    )
    cluster_threat_ids: list[uuid.UUID] = Field(
        default_factory=list,
        max_length=12,
        description=(
            "Optional set of threats to summarise as a potential campaign. Members are "
            "grouped only by exact shared identifiers the risk engine recorded."
        ),
    )
    history: list[AnalystTurn] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def _needs_subject(self) -> "AnalystRequest":
        if self.threat_id is None and self.entity_id is None and not self.cluster_threat_ids:
            raise ValueError("Provide threat_id, entity_id or cluster_threat_ids so the analyst has a subject.")
        if self.cluster_threat_ids and self.compare_threat_id is not None:
            raise ValueError("Use either compare_threat_id or cluster_threat_ids, not both.")
        return self


class AnalystCitations(BaseModel):
    evidence_ids: list[uuid.UUID] = Field(default_factory=list)
    threat_ids: list[uuid.UUID] = Field(default_factory=list)
    entity_ids: list[uuid.UUID] = Field(default_factory=list)


class AnalystContextSummary(BaseModel):
    """What the answer was allowed to draw on — shown to the analyst."""

    threat_ids: list[uuid.UUID]
    entity_ids: list[uuid.UUID]
    evidence_count: int
    related_count: int
    brand_names: list[str]
    missing: list[str] = Field(description="Data that was unavailable or does not exist.")


class AnalystResponse(BaseModel):
    answer: str
    intent: str
    source: Literal["GROQ", "TEMPLATE"]
    model: str | None
    citations: AnalystCitations
    context: AnalystContextSummary
    limitations: list[str] = Field(default_factory=list)
    notes: list[str] = Field(
        default_factory=list, description="Why a template was used, or grounding adjustments."
    )
    generated_at: datetime


class AnalystStatusResponse(BaseModel):
    llm_provider: str
    llm_configured: bool
    model: str
    grounding: str
