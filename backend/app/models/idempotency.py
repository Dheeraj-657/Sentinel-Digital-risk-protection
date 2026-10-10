from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.analysis import AnalysisJob
from app.models.base import Base, UTCDateTime, UUIDPrimaryKeyMixin, utcnow


class IdempotencyRecord(Base, UUIDPrimaryKeyMixin):
    """Stores Idempotency-Key -> job mappings scoped per tenant.

    Fingerprint collisions (same key, different payload) are rejected with
    DUPLICATE_JOB / HTTP 409; matching fingerprints replay the original job.
    """

    __tablename__ = "idempotency_records"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_idempotency_tenant_key"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)

    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False
    )
    job: Mapped[AnalysisJob] = relationship()

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
