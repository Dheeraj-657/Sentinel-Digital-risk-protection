"""Discovery job persistence.

A DiscoveryJob records one bounded automatic-discovery run for one brand:
the Brand-DNA-derived queries, per-provider outcomes (including
UNCONFIGURED / TIMEOUT / RATE_LIMITED verdicts), the normalized
deduplicated candidate list, and the Module 3 / Module 2 artifacts each
candidate produced (source_id, entity_id, evidence_id, analysis_job_id).

Candidates are OBSERVATIONS, not verdicts: a discovered domain is never
treated as proof of malicious intent — Module 2's canonical scoring engine
evaluates the stored evidence.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, Integer, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.enums import DiscoveryJobStatus
from app.models.base import Base, UTCDateTime, UUIDPrimaryKeyMixin, utcnow


class DiscoveryJob(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "discovery_jobs"
    __table_args__ = (Index("ix_discovery_jobs_tenant_status", "tenant_id", "status"),)

    tenant_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    brand_id: Mapped[uuid.UUID] = mapped_column(nullable=False)

    status: Mapped[DiscoveryJobStatus] = mapped_column(
        SAEnum(
            DiscoveryJobStatus,
            native_enum=False,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=DiscoveryJobStatus.QUEUED,
    )

    # [{provider, term, basis}] — the exact Brand-DNA-derived lookups issued.
    queries: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # [{provider, status, candidate_count, warning, error, latency_ms}]
    provider_outcomes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Normalized, cross-provider-deduplicated candidates (see
    # app/services/discovery.py for the exact shape).
    candidates: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # {provider_name: module3_source_id} — one provenance source per provider
    # per job, reused across retries so evidence is not duplicated.
    source_ids: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    duplicate_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    warning_message: Mapped[str | None] = mapped_column(String(512), nullable=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(512), nullable=True)

    @property
    def candidate_count(self) -> int:
        return len(self.candidates or [])
